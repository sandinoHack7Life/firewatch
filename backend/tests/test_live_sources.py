import asyncio
import json
from datetime import date
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.v1.endpoints import (
    alerts as alerts_endpoint,
    analytics as analytics_endpoint,
    calendar as calendar_endpoint,
    dashboard as dashboard_endpoint,
    field_visits as field_visits_endpoint,
    fire_map as fire_map_endpoint,
    fires as fires_endpoint,
    harmonization as harmonization_endpoint,
    planetary_computer as planetary_computer_endpoint,
    reports as reports_endpoint,
    system as system_endpoint,
)
from app.core.config import Settings
from app.repositories.field_visit_repository import FieldVisitRepository
from app.repositories.fire_repository import FireRepository
from app.schemas.alerts import TestAlertRequest as AlertTestRequest
from app.schemas.alerts import WatchlistCreate
from app.schemas.field_visit import FieldVisitPayload
from app.services.alerts.service import AlertService
from app.services.calendar.service import aggregate_calendar
from app.services.firms.client import FIRMSClient, FIRMSResponseError, FIRMS_SOURCES
from app.services.firms.eonet import EONETClient
from app.services.parks.registry import (
    MOZAMBIQUE_FIRMS_BBOX,
    filter_records_by_park,
    intersect_bboxes,
    list_parks,
    park_bbox,
    point_in_park,
)
from app.services.planetary_computer.client import PlanetaryComputerClient
from app.services.reports.service import build_geojson
from app.services.runtime import sync_service as runtime_sync_service
from app.services.sync_service import LiveSyncService
from app.main import app


def test_firms_csv_preserves_confidence_and_skips_invalid_coordinates() -> None:
    csv_text = (
        'latitude,longitude,acq_date,acq_time,satellite,instrument,confidence,frp\n'
        '12.5,-45.0,2026-03-01,1230,NOAA-20,VIIRS,n,9.3\n'
        'invalid,-45.0,2026-03-01,1230,NOAA-20,VIIRS,h,8.0\n'
    )

    records = FIRMSClient.parse_csv_csv(csv_text, 'VIIRS_NOAA20_NRT')

    assert len(records) == 1
    assert records[0]['confidence'] == 'n'
    assert records[0]['frp'] == 9.3


def test_firms_error_body_is_not_mistaken_for_a_valid_empty_feed() -> None:
    with pytest.raises(FIRMSResponseError):
        FIRMSClient.parse_csv_csv('Authentication failed')

    assert FIRMSClient.parse_csv_csv('latitude,longitude\n') == []


def test_firms_request_uses_one_mozambique_national_bbox() -> None:
    requested_paths: list[str] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requested_paths.append(request.url.path)
        return httpx.Response(200, text='latitude,longitude\n')

    async def fetch() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            await FIRMSClient('test-key').fetch_source('MODIS_NRT', client=client)

    asyncio.run(fetch())

    assert requested_paths == [
        '/api/area/csv/test-key/MODIS_NRT/30.2,-26.9,40.9,-10.4/2',
    ]
    assert MOZAMBIQUE_FIRMS_BBOX == (30.2, -26.9, 40.9, -10.4)


def test_firms_map_key_is_read_from_existing_environment_name(monkeypatch) -> None:
    monkeypatch.setenv('FIRMS_MAP_KEY', 'environment-test-map-key')

    settings = Settings(_env_file=None)

    assert settings.firms_map_key == 'environment-test-map-key'


def test_sync_service_passes_configured_key_to_firms_client(tmp_path) -> None:
    settings = Settings(firms_map_key='configured-test-map-key')
    service = LiveSyncService(
        settings,
        FireRepository(tmp_path / 'observations.sqlite3'),
    )

    assert service.firms.api_key == 'configured-test-map-key'


def test_configured_sync_starts_all_existing_firms_feeds(monkeypatch, tmp_path) -> None:
    service = LiveSyncService(
        Settings(firms_map_key='configured-test-map-key'),
        FireRepository(tmp_path / 'observations.sqlite3'),
    )
    requested: list[tuple[str, tuple[float, float, float, float], int]] = []

    async def fetch_source(source: str, *, day_range, area, client):
        requested.append((source, area, day_range))
        return []

    async def fetch_events(client):
        return []

    monkeypatch.setattr(service.firms, 'fetch_source', fetch_source)
    monkeypatch.setattr(service.eonet, 'fetch_events', fetch_events)
    telemetry = asyncio.run(service.sync_once())

    assert [feed for feed, _, _ in requested] == list(FIRMS_SOURCES)
    assert all(area == MOZAMBIQUE_FIRMS_BBOX for _, area, _ in requested)
    assert all(day_range == service.settings.firms_day_range for _, _, day_range in requested)
    assert all(telemetry['sources'][feed]['status'] == 'online' for feed in FIRMS_SOURCES)


def test_whitespace_firms_key_is_treated_as_missing(monkeypatch, tmp_path) -> None:
    service = LiveSyncService(
        Settings(firms_map_key='   '),
        FireRepository(tmp_path / 'observations.sqlite3'),
    )

    async def unexpected_firms_request(*args, **kwargs):
        raise AssertionError('A blank map key must not reach NASA FIRMS.')

    async def no_events(client: httpx.AsyncClient):
        return []

    monkeypatch.setattr(service.firms, 'fetch_source', unexpected_firms_request)
    monkeypatch.setattr(service.eonet, 'fetch_events', no_events)
    telemetry = asyncio.run(service.sync_once())

    assert all(
        telemetry['sources'][feed]['status'] == 'credentials_required'
        for feed in FIRMS_SOURCES
    )


def test_sync_service_start_does_not_wait_for_external_sources(tmp_path, monkeypatch) -> None:
    service = LiveSyncService(
        Settings(),
        FireRepository(tmp_path / 'observations.sqlite3'),
    )

    async def exercise() -> None:
        started = asyncio.Event()
        release = asyncio.Event()

        async def blocked_sync():
            started.set()
            await release.wait()
            return {}

        monkeypatch.setattr(service, 'sync_once', blocked_sync)
        task = await asyncio.wait_for(service.start(), timeout=0.1)
        await asyncio.wait_for(started.wait(), timeout=0.1)
        assert not task.done()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass

    asyncio.run(exercise())


def test_health_and_parks_respond_while_live_sync_is_pending(monkeypatch) -> None:
    async def blocked_sync():
        await asyncio.Event().wait()

    monkeypatch.setattr(runtime_sync_service, 'sync_once', blocked_sync)
    with TestClient(app) as client:
        health = client.get('/api/v1/health')
        parks = client.get('/api/v1/parks')

    assert health.status_code == 200
    assert health.json()['status'] == 'ok'
    assert parks.status_code == 200
    assert any(park['id'] == 'gorongosa' for park in parks.json()['items'])


def test_protected_area_registry_contains_mapped_areas_and_filters_points() -> None:
    parks = list_parks()

    gorongosa = next(park for park in parks if park['id'] == 'gorongosa')
    assert gorongosa['name'] == 'Gorongosa National Park'
    assert gorongosa['province'] == 'Sofala'
    assert [park['id'] for park in parks] == [
        'gorongosa', 'limpopo', 'banhine', 'zinave',
        'bazaruto', 'maputo', 'magoe', 'quirimbas',
        'niassa_special_reserve', 'niassa_lake_partial_reserve',
        'marromeu_national_reserve', 'pomene_national_reserve',
        'licuati_forest_reserve', 'ribaue_forest_reserve',
        'zomba_forest_reserve', 'nhapacue_forest_reserve',
        'mupalue_forest_reserve', 'moribane_forest_reserve',
        'mecuburi_forest_reserve', 'matibane_forest_reserve',
        'maronga_forest_reserve', 'inhamitanga_forest_reserve',
        'derre_forest_reserve', 'baixo_pinda_forest_reserve',
        'mucheve_forest_reserve',
    ]
    reserve_names = {
        park['id']: park['name']
        for park in parks
        if park['area_type'] != 'national_park'
    }
    assert reserve_names == {
        'niassa_special_reserve': 'Reserva Especial do Niassa',
        'niassa_lake_partial_reserve': 'Reserva Parcial do Lago Niassa',
        'marromeu_national_reserve': 'Reserva Nacional de Marromeu',
        'pomene_national_reserve': 'Reserva Nacional de Pomene',
        'licuati_forest_reserve': 'Reserva Florestal de Licuáti',
        'ribaue_forest_reserve': 'Reserva Florestal de Ribáuè',
        'zomba_forest_reserve': 'Reserva Florestal de Zomba',
        'nhapacue_forest_reserve': 'Reserva Florestal de Nhapacue',
        'mupalue_forest_reserve': 'Reserva Florestal de Mupalue',
        'moribane_forest_reserve': 'Reserva Florestal de Moribane',
        'mecuburi_forest_reserve': 'Reserva Florestal de Mecubúri',
        'matibane_forest_reserve': 'Reserva Florestal de Matibane',
        'maronga_forest_reserve': 'Reserva Florestal de Maronga',
        'inhamitanga_forest_reserve': 'Reserva Florestal de Inhamitanga',
        'derre_forest_reserve': 'Reserva Florestal de Derre',
        'baixo_pinda_forest_reserve': 'Reserva Florestal de Baixo Pinda',
        'mucheve_forest_reserve': 'Reserva Florestal de Mucheve',
    }
    assert sum(park['area_type'] == 'national_park' for park in parks) == 8
    assert sum(park['area_type'] == 'fauna_reserve' for park in parks) == 4
    assert sum(park['area_type'] == 'forest_reserve' for park in parks) == 13
    niassa = next(park for park in parks if park['id'] == 'niassa_special_reserve')
    licuati = next(park for park in parks if park['id'] == 'licuati_forest_reserve')
    assert niassa['name'] == 'Reserva Especial do Niassa'
    assert niassa['province'] == 'Niassa'
    assert niassa['area_type'] == 'fauna_reserve'
    assert niassa['boundary_url'] == 'https://www.openstreetmap.org/relation/6793881'
    assert niassa['boundary_quality'] == 'mapped'
    assert licuati['name'] == 'Reserva Florestal de Licuáti'
    assert licuati['province'] is None
    assert licuati['area_type'] == 'forest_reserve'
    assert 'RCMRD OFESA' in licuati['boundary_source']
    assert licuati['boundary_quality'] == 'mapped'
    assert {
        park['id']
        for park in parks
        if park['boundary_quality'] == 'approximate'
    } == {'bazaruto', 'niassa_lake_partial_reserve', 'pomene_national_reserve'}
    assert all(
        park['province'] is None
        for park in parks
        if park['area_type'] == 'forest_reserve'
    )
    for park in parks:
        geometry = park['geometry']
        polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
        longitude, latitude = polygon[0][0]
        assert point_in_park(longitude, latitude, park['id'])
        assert park_bbox(park['id']) == park['bbox']
        assert park['bbox'][0] < park['bbox'][2]
        assert park['bbox'][1] < park['bbox'][3]
        assert filter_records_by_park(
            [{'longitude': longitude, 'latitude': latitude}],
            park['id'],
        ) == [{'longitude': longitude, 'latitude': latitude}]
        assert park['boundary_source']
        assert park['boundary_license']
        assert park['boundary_url']
    assert not point_in_park(0, 0, 'gorongosa')


def test_all_conservation_areas_are_available_to_map_analytics_and_field_visits() -> None:
    client = TestClient(app)
    response = client.get('/api/v1/parks')
    assert response.status_code == 200
    parks = response.json()['items']
    assert len(parks) == 25

    for park in parks:
        params = {'park_id': park['id']}
        assert client.get('/api/v1/fire-map', params=params).status_code == 200
        assert client.get('/api/v1/fires', params=params).status_code == 200
        assert client.get('/api/v1/dashboard/summary', params=params).status_code == 200
        assert client.get('/api/v1/analytics/trends', params=params).status_code == 200
        assert client.get('/api/v1/field-visits', params=params).status_code == 200


def test_mapped_reserves_scope_live_firms_map_bounds_and_dashboard_metrics(monkeypatch, tmp_path) -> None:
    repository = FireRepository(tmp_path / 'reserve-observations.sqlite3')
    areas = {
        park['id']: park
        for park in list_parks()
        if park['id'] in {'niassa_special_reserve', 'licuati_forest_reserve'}
    }

    def boundary_point(area_id: str) -> tuple[float, float]:
        geometry = areas[area_id]['geometry']
        polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
        longitude, latitude = polygon[0][0]
        return longitude, latitude

    niassa_lon, niassa_lat = boundary_point('niassa_special_reserve')
    licuati_lon, licuati_lat = boundary_point('licuati_forest_reserve')
    repository.replace_source('MODIS_NRT', [
        {
            'observation_id': 'niassa-live-modis',
            'acquisition_date': '2026-03-01',
            'acquisition_time': '0830',
            'latitude': niassa_lat,
            'longitude': niassa_lon,
            'instrument': 'MODIS',
            'satellite': 'Terra',
            'feed': 'MODIS_NRT',
            'source': 'NASA FIRMS',
            'frp': 12.0,
        },
        {
            'observation_id': 'licuati-live-modis',
            'acquisition_date': '2026-03-02',
            'acquisition_time': '0915',
            'latitude': licuati_lat,
            'longitude': licuati_lon,
            'instrument': 'MODIS',
            'satellite': 'Aqua',
            'feed': 'MODIS_NRT',
            'source': 'NASA FIRMS',
            'frp': 8.0,
        },
    ])
    captured_bboxes: list[tuple[float, float, float, float]] = []
    original_list_records = repository.list_records

    def record_bbox(**kwargs):
        captured_bboxes.append(kwargs['bbox'])
        return original_list_records(**kwargs)

    monkeypatch.setattr(repository, 'list_records', record_bbox)
    field_visits = FieldVisitRepository(tmp_path / 'reserve-visits.sqlite3')
    for endpoint in (fire_map_endpoint, dashboard_endpoint):
        monkeypatch.setattr(endpoint, 'fire_repository', repository)
        monkeypatch.setattr(endpoint, 'field_visit_repository', field_visits)

    client = TestClient(app)
    for area_id, expected_observation in (
        ('niassa_special_reserve', 'niassa-live-modis'),
        ('licuati_forest_reserve', 'licuati-live-modis'),
    ):
        fire_map = client.get(f'/api/v1/fire-map?park_id={area_id}').json()
        summary = client.get(f'/api/v1/dashboard/summary?park_id={area_id}').json()
        assert [item['observation_id'] for item in fire_map['items']] == [expected_observation]
        assert summary['total_detections'] == 1
        assert summary['modis_detections'] == 1
        assert captured_bboxes[-2:] == [areas[area_id]['bbox'], areas[area_id]['bbox']]


def test_park_bbox_non_intersection_is_not_a_global_query() -> None:
    assert intersect_bboxes((30, -27, 31, -26), (32, -20, 35, -17)) is None
    assert intersect_bboxes((30, -20, 35, -15), (32, -18, 38, -12)) == (32, -18, 35, -15)


def test_park_endpoints_return_empty_for_non_intersecting_bbox(monkeypatch) -> None:
    class UnexpectedRepository:
        def list_records(self, **kwargs):
            raise AssertionError('A non-intersecting park query must not load global observations.')

        def get_summary(self, records):
            return {
                'total_detections': len(records),
                'modis_detections': 0,
                'viirs_detections': 0,
                'eonet_events': 0,
                'selected_area': 'global',
                'selected_period': 'live feed',
                'source_counts': {},
                'source_note': 'Live source records only; no synthetic observations are used.',
            }

    repository = UnexpectedRepository()
    monkeypatch.setattr(fire_map_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(calendar_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(reports_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(dashboard_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(fires_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(analytics_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(harmonization_endpoint, 'fire_repository', repository)
    client = TestClient(app)

    summary = client.get('/api/v1/dashboard/summary?park_id=gorongosa&bbox=0,0,1,1')
    fires = client.get('/api/v1/fires?park_id=gorongosa&bbox=0,0,1,1')
    fire_map = client.get('/api/v1/fire-map?park_id=gorongosa&bbox=0,0,1,1')
    calendar = client.get('/api/v1/calendar?park_id=gorongosa&bbox=0,0,1,1')
    trends = client.get('/api/v1/analytics/trends?park_id=gorongosa&bbox=0,0,1,1')
    harmonization = client.get('/api/v1/harmonization/summary?park_id=gorongosa&bbox=0,0,1,1')
    report = client.post('/api/v1/reports/generate', json={
        'park_id': 'gorongosa',
        'bbox': [0, 0, 1, 1],
    })

    assert summary.status_code == 200 and summary.json()['total_detections'] == 0
    assert fires.status_code == 200 and fires.json()['total'] == 0
    assert fire_map.status_code == 200 and fire_map.json()['items'] == []
    assert calendar.status_code == 200 and calendar.json()['items'] == []
    assert trends.status_code == 200 and trends.json()['items'] == []
    assert harmonization.status_code == 200 and harmonization.json()['total_observations'] == 0
    assert report.status_code == 200 and report.json()['record_count'] == 0


def test_park_id_scopes_monitoring_endpoints_and_missing_id_defaults_to_gorongosa(monkeypatch, tmp_path) -> None:
    repository = FireRepository(tmp_path / 'observations.sqlite3')
    parks = {park['id']: park for park in list_parks()}

    def first_boundary_point(park_id: str) -> tuple[float, float]:
        geometry = parks[park_id]['geometry']
        ring = geometry['coordinates'][0][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates'][0]
        longitude, latitude = ring[0]
        return longitude, latitude

    gorongosa_lon, gorongosa_lat = first_boundary_point('gorongosa')
    maputo_lon, maputo_lat = first_boundary_point('maputo')
    repository.replace_source('MODIS_NRT', [{
        'observation_id': 'gorongosa-modis',
        'acquisition_date': '2026-03-01',
        'acquisition_time': '0830',
        'latitude': gorongosa_lat,
        'longitude': gorongosa_lon,
        'instrument': 'MODIS',
        'satellite': 'Aqua',
        'feed': 'MODIS_NRT',
        'source': 'NASA FIRMS',
        'frp': 12.0,
    }])
    repository.replace_source('VIIRS_SNPP_NRT', [{
        'observation_id': 'maputo-viirs',
        'acquisition_date': '2026-03-02',
        'acquisition_time': '0915',
        'latitude': maputo_lat,
        'longitude': maputo_lon,
        'instrument': 'VIIRS',
        'satellite': 'Suomi NPP',
        'feed': 'VIIRS_SNPP_NRT',
        'source': 'NASA FIRMS',
        'frp': 8.0,
    }])
    endpoint_modules = (
        analytics_endpoint,
        calendar_endpoint,
        dashboard_endpoint,
        fire_map_endpoint,
        fires_endpoint,
        harmonization_endpoint,
        reports_endpoint,
    )
    for endpoint in endpoint_modules:
        monkeypatch.setattr(endpoint, 'fire_repository', repository)
    monkeypatch.setattr(system_endpoint.sync_service, 'repository', repository)

    client = TestClient(app)
    scoped_summary = client.get('/api/v1/dashboard/summary?park_id=gorongosa').json()
    default_summary = client.get('/api/v1/dashboard/summary').json()
    assert scoped_summary['total_detections'] == 1
    assert scoped_summary['modis_detections'] == 1
    assert scoped_summary['viirs_detections'] == 0
    assert default_summary['total_detections'] == 1
    assert default_summary['modis_detections'] == 1

    assert client.get('/api/v1/fires?park_id=gorongosa').json()['total'] == 1
    assert client.get('/api/v1/fires').json()['total'] == 1
    assert client.get('/api/v1/fires?park_id=maputo').json()['total'] == 1
    assert client.get('/api/v1/fire-map?park_id=gorongosa').json()['count'] == 1
    assert client.get('/api/v1/fire-map').json()['count'] == 1
    assert client.get('/api/v1/fire-map?park_id=maputo').json()['count'] == 1
    scoped_calendar = client.get('/api/v1/calendar?park_id=gorongosa').json()['items']
    default_calendar = client.get('/api/v1/calendar').json()['items']
    assert sum(item['total'] for item in scoped_calendar) == 1
    assert sum(item['total'] for item in default_calendar) == 1

    scoped_trends = client.get('/api/v1/analytics/trends?park_id=gorongosa').json()['items']
    assert sum(item['total'] for item in scoped_trends) == 1
    scoped_comparison = client.get('/api/v1/analytics/comparison?park_id=gorongosa').json()
    assert scoped_comparison['comparison']['series'] == [1, 0]
    scoped_harmonization = client.get('/api/v1/harmonization/summary?park_id=gorongosa').json()
    assert scoped_harmonization['total_observations'] == 1
    assert scoped_harmonization['modis_observations'] == 1
    assert client.get('/api/v1/system/telemetry?park_id=gorongosa').json()['observation_count'] == 2
    assert client.get('/api/v1/system/telemetry').json()['observation_count'] == 2

    assert client.get('/api/v1/fires/gorongosa-modis?park_id=gorongosa').status_code == 200
    assert client.get('/api/v1/fires/gorongosa-modis?park_id=maputo').status_code == 404
    specific_report = client.post('/api/v1/reports/generate', json={'park_id': 'gorongosa'})
    default_report = client.post('/api/v1/reports/generate', json={})
    assert specific_report.json()['record_count'] == 1
    assert default_report.json()['record_count'] == 1
    assert client.get('/api/v1/reports?park_id=gorongosa').json()['available_record_count'] == 1
    assert client.get('/api/v1/reports').json()['available_record_count'] == 1


def test_unknown_park_ids_return_clear_bad_request() -> None:
    client = TestClient(app)
    invalid_paths = (
        '/api/v1/fires?park_id=',
        '/api/v1/dashboard/summary?park_id=not-a-park',
        '/api/v1/fires?park_id=not-a-park',
        '/api/v1/fire-map?park_id=not-a-park',
        '/api/v1/calendar?park_id=not-a-park',
        '/api/v1/analytics/trends?park_id=not-a-park',
        '/api/v1/analytics/comparison?park_id=not-a-park',
        '/api/v1/analytics/anomalies?park_id=not-a-park',
        '/api/v1/harmonization/summary?park_id=not-a-park',
        '/api/v1/harmonization/matches?park_id=not-a-park',
        '/api/v1/reports?park_id=not-a-park',
        '/api/v1/alerts?park_id=not-a-park',
        '/api/v1/system/telemetry?park_id=not-a-park',
        '/api/v1/fires/unknown-observation?park_id=not-a-park',
        '/api/v1/planetary-computer/search?bbox=30,-27,41,-10&park_id=not-a-park',
        '/api/v1/alerts/history?park_id=not-a-park',
    )
    for path in invalid_paths:
        response = client.get(path)
        assert response.status_code == 400
        assert 'Unknown park_id' in response.json()['detail']

    field_response = client.get('/api/v1/field-visits?park_id=not-a-park')
    assert field_response.status_code == 400

    alert_response = client.post('/api/v1/alerts', json={
        'name': 'Invalid park',
        'geofence_type': 'park',
        'park_id': 'not-a-park',
        'recipients': ['ranger@example.org'],
    })
    assert alert_response.status_code == 400

    report_response = client.post('/api/v1/reports/generate', json={'park_id': 'not-a-park'})
    assert report_response.status_code == 400


def test_park_scope_applies_to_stac_bbox_and_alert_history(monkeypatch) -> None:
    park = next(park for park in list_parks() if park['id'] == 'gorongosa')

    class StubStacClient:
        requested_bbox = None

        async def search(self, *, bbox, start_date, end_date, collections, limit):
            self.requested_bbox = bbox
            return []

    stac_client = StubStacClient()
    monkeypatch.setattr(planetary_computer_endpoint, 'client', stac_client)
    bounds = park['bbox']
    response = TestClient(app).get(
        '/api/v1/planetary-computer/search',
        params={'bbox': '30,-27,41,-10', 'park_id': 'gorongosa'},
    )
    assert response.status_code == 200 and response.json()['items'] == []
    assert stac_client.requested_bbox == bounds

    geometry = park['geometry']
    polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
    longitude, latitude = polygon[0][0]
    other_park = next(park for park in list_parks() if park['id'] == 'maputo')
    other_geometry = other_park['geometry']
    other_polygon = other_geometry['coordinates'][0] if other_geometry['type'] == 'MultiPolygon' else other_geometry['coordinates']
    other_longitude, other_latitude = other_polygon[0][0]
    history = [
        {
            'id': 'mixed',
            'matched_observations': [
                {'longitude': longitude, 'latitude': latitude},
                {'longitude': other_longitude, 'latitude': other_latitude},
            ],
        },
        {
            'id': 'other-park-only',
            'matched_observations': [
                {'longitude': other_longitude, 'latitude': other_latitude},
            ],
        },
    ]
    monkeypatch.setattr(alerts_endpoint.alert_service, 'list_history', lambda limit: history)
    filtered_history = TestClient(app).get('/api/v1/alerts/history?park_id=gorongosa').json()['items']
    default_history = TestClient(app).get('/api/v1/alerts/history').json()['items']
    assert [item['id'] for item in filtered_history] == ['mixed']
    assert len(filtered_history[0]['matched_observations']) == 1
    assert [item['id'] for item in default_history] == ['mixed']
    assert len(default_history[0]['matched_observations']) == 1


def test_alert_lists_and_history_follow_the_selected_park(monkeypatch) -> None:
    watchlists = [
        {'id': 'goro', 'geofence_type': 'park', 'park_id': 'gorongosa'},
        {'id': 'maputo', 'geofence_type': 'park', 'park_id': 'maputo'},
        {'id': 'national', 'geofence_type': 'preset', 'park_id': None},
    ]
    monkeypatch.setattr(alerts_endpoint.alert_service, 'list_watchlists', lambda: watchlists)
    client = TestClient(app)

    default_items = client.get('/api/v1/alerts').json()['watchlists']
    maputo_items = client.get('/api/v1/alerts?park_id=maputo').json()['watchlists']

    assert {item['id'] for item in default_items} == {'goro', 'national'}
    assert {item['id'] for item in maputo_items} == {'maputo', 'national'}


def test_server_side_firms_secret_is_not_returned_to_public_api_or_client_assets(monkeypatch) -> None:
    from app.services.runtime import sync_service

    secret_marker = 'server-only-test-map-key-marker'
    monkeypatch.setattr(sync_service, 'settings', Settings(firms_map_key=secret_marker))
    client = TestClient(app)
    for path in ('/api/v1/health', '/api/v1/data-sources', '/api/v1/system/telemetry'):
        assert secret_marker not in client.get(path).text

    frontend = Path(__file__).resolve().parents[2] / 'frontend'
    client_files = list((frontend / 'src').rglob('*.ts')) + list((frontend / 'src').rglob('*.tsx'))
    client_files.extend((frontend / 'dist' / 'assets').glob('*.js'))
    assert all(
        secret_marker not in path.read_text(encoding='utf-8')
        and 'FIRMS_MAP_KEY' not in path.read_text(encoding='utf-8')
        for path in client_files
    )

    api_source = (frontend / 'src' / 'services' / 'api.ts').read_text(encoding='utf-8')
    layout_source = (frontend / 'src' / 'components' / 'layout' / 'AppLayout.tsx').read_text(encoding='utf-8')
    assert 'park_id: ParkId;' in api_source
    assert '`/fire-map${queryString(params)}`' in api_source
    assert 'park_id: selectedParkId,' in layout_source


def test_frontend_park_selection_is_registry_valid_and_shared() -> None:
    frontend = Path(__file__).resolve().parents[2] / 'frontend' / 'src'
    layout = (frontend / 'components' / 'layout' / 'AppLayout.tsx').read_text(encoding='utf-8')
    api_source = (frontend / 'services' / 'api.ts').read_text(encoding='utf-8')
    field_visits = (frontend / 'features' / 'field-visits' / 'FieldVisitsPage.tsx').read_text(encoding='utf-8')

    assert "const DEFAULT_PARK_ID: ParkId = 'gorongosa';" in layout
    assert "const EXPLICIT_PARK_STORAGE_KEY = 'firewatch-explicit-national-park';" in layout
    assert "const LEGACY_PARK_STORAGE_KEY = 'firewatch-national-park';" in layout
    assert 'selectedParkId, setSelectedParkIdState] = useState<ParkId>(DEFAULT_PARK_ID)' in layout
    assert 'window.localStorage.getItem(EXPLICIT_PARK_STORAGE_KEY)' in layout
    assert 'window.localStorage.removeItem(LEGACY_PARK_STORAGE_KEY)' in layout
    assert 'queryPark ?? savedPark ?? defaultPark' in layout
    assert 'const selectedPark = queryPark ?? savedPark ?? defaultPark;' in layout
    assert "window.localStorage.setItem(EXPLICIT_PARK_STORAGE_KEY, parkId)" in layout
    assert "window.localStorage.setItem('firewatch-national-park'" not in layout
    assert 'park_id: selectedParkId,' in layout
    assert "searchParams.set('park_id', parkId)" in layout
    assert 'routeParkSelectionReady' in layout
    assert 'api.getTelemetry(selectedParkId)' in layout
    assert '<option value="all">' not in layout
    assert '<option value="">' not in layout
    assert "t('All parks')" not in layout
    assert 'All parks' not in (frontend / 'i18n' / 'locales' / 'en.json').read_text(encoding='utf-8')
    assert 'All parks' not in (frontend / 'i18n' / 'locales' / 'pt.json').read_text(encoding='utf-8')
    assert 'PARK_GROUPS.map(({ areaType, label }) =>' in layout
    assert "areaType: 'fauna_reserve'" in layout
    assert "areaType: 'forest_reserve'" in layout
    assert '}, [parkLoadAttempt]);' in layout
    assert 'const telemetryRefreshMs = !telemetry || telemetry.status === \'starting\' ? 5_000 : 30_000;' in layout
    assert 'STARTUP_REQUEST_TIMEOUT_MS = 10_000' in api_source
    assert 'park.name}{park.province ? ` - ${park.province}`' in layout
    assert 'const park = parks.find((item) => item.id === event.target.value)' in layout
    assert 'if (park) selectPark(park.id)' in layout
    assert 'park_id: ParkId;' in api_source
    assert 'getFireMap: (params: GlobalQuery &' in api_source
    assert 'getDashboardSummary: (filters: GlobalQuery)' in api_source
    assert 'getTelemetry: (parkId: ParkId)' in api_source
    assert 'getWatchlists: (parkId: ParkId)' in api_source
    assert 'getAlertHistory: (parkId: ParkId)' in api_source
    assert 'getFieldVisits: (parkId: ParkId)' in api_source
    assert 'X-Field-Data-Key' not in api_source
    assert 'firewatch-explicit-national-park' not in field_visits
    assert 'visitParkId' not in field_visits
    request_checks = {
        'dashboard/DashboardPage.tsx': ('api.getDashboardSummary(filters)', 'filters'),
        'fire-map/FireMapPage.tsx': ('api.getFireMap({', '...filters'),
        'calendar/CalendarPage.tsx': ('api.getCalendar({', '...filters'),
        'analytics/AnalyticsPage.tsx': ('api.getAnalyticsTrends(filters)', 'filters'),
        'harmonization/HarmonizationPage.tsx': ('api.getHarmonizationSummary(filters)', 'filters'),
        'data-explorer/DataExplorerPage.tsx': ('api.getFires({', '...filters'),
        'reports/ReportsPage.tsx': ('park_id: filters.park_id', 'filters'),
        'alerts/AlertsPage.tsx': ('api.getAlertHistory(selectedParkId)', 'selectedParkId'),
        'field-visits/FieldVisitsPage.tsx': ('api.getFireMap({', '...filters'),
    }
    for relative_path, (request, selected_park) in request_checks.items():
        page_source = (frontend / 'features' / relative_path).read_text(encoding='utf-8')
        assert 'useOperationalContext' in page_source
        assert request in page_source
        assert selected_park in page_source


def test_eonet_client_normalizes_live_event_without_inventing_sensor_values() -> None:
    payload = {
        'events': [{
            'id': 'EONET_123',
            'title': 'Wildfire event',
            'link': 'https://eonet.gsfc.nasa.gov/api/v3/events/EONET_123',
            'sources': [{'url': 'https://example.org/source'}],
            'geometry': [{
                'type': 'Polygon',
                'date': '2026-03-01T12:30:00Z',
                'coordinates': [[[10, 20], [12, 20], [12, 22], [10, 22], [10, 20]]],
            }],
        }],
    }

    async def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=payload)

    async def fetch() -> list[dict[str, object]]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await EONETClient('https://eonet.test/events').fetch_events(client)

    records = asyncio.run(fetch())

    assert len(records) == 1
    assert records[0]['instrument'] == 'EONET'
    assert records[0]['frp'] is None
    assert records[0]['confidence'] is None
    assert records[0]['latitude'] == pytest.approx(20.8)
    assert records[0]['longitude'] == pytest.approx(10.8)


def test_repository_deduplicates_and_persists_records(tmp_path) -> None:
    repository = FireRepository(tmp_path / 'observations.sqlite3')
    record = {
        'observation_id': 'observation-1',
        'acquisition_date': date.today().isoformat(),
        'latitude': 1.0,
        'longitude': 2.0,
        'instrument': 'VIIRS',
        'source': 'NASA FIRMS',
    }

    assert repository.replace_source('VIIRS_SNPP_NRT', [record]) == [dict(record, feed='VIIRS_SNPP_NRT')]
    assert repository.replace_source('VIIRS_SNPP_NRT', [record]) == []
    assert repository.list_records(limit=None)[0]['observation_id'] == 'observation-1'


def test_field_visit_payload_requires_paired_coordinates_and_normalizes_utc() -> None:
    payload = {
        'client_id': 'offline-client-123',
        'park_id': 'gorongosa',
        'satellite_observation_id': 'source-observation-1',
        'satellite_feed': 'VIIRS_SNPP_NRT',
        'form_created_at_utc': '2026-03-01T10:00:00+02:00',
        'field_latitude': -18.8,
        'field_longitude': 34.5,
    }

    visit = FieldVisitPayload.model_validate(payload)

    assert visit.form_created_at_utc.isoformat() == '2026-03-01T08:00:00+00:00'
    with pytest.raises(ValidationError):
        FieldVisitPayload.model_validate({**payload, 'field_longitude': None})
    manual = FieldVisitPayload.model_validate({
        **payload,
        'record_type': 'manual',
        'satellite_observation_id': None,
        'satellite_feed': None,
    })
    assert manual.record_type == 'manual'
    with pytest.raises(ValidationError):
        FieldVisitPayload.model_validate({
            **payload,
            'record_type': 'manual',
            'satellite_observation_id': 'source-observation-1',
            'satellite_feed': 'VIIRS_SNPP_NRT',
        })
    with pytest.raises(ValidationError):
        FieldVisitPayload.model_validate({
            **payload,
            'report_reference': 'FW-GOR-2026\r\nBcc: other@example.org',
        })


def test_field_visit_storage_is_idempotent_and_separate_from_observations(tmp_path) -> None:
    fire_repository = FireRepository(tmp_path / 'observations.sqlite3')
    visits_repository = FieldVisitRepository(tmp_path / 'private' / 'field_visits.sqlite3')
    observation = {
        'observation_id': 'source-observation-1',
        'acquisition_date': '2026-03-01',
        'latitude': -18.8,
        'longitude': 34.5,
        'instrument': 'VIIRS',
        'feed': 'VIIRS_SNPP_NRT',
        'source': 'NASA FIRMS',
    }
    fire_repository.replace_source('VIIRS_SNPP_NRT', [observation])
    visit = {
        'client_id': 'offline-client-123',
        'park_id': 'gorongosa',
        'form_created_at_utc': '2026-03-01T08:00:00+00:00',
        'updated_at_utc': '2026-03-01T08:00:00+00:00',
        'satellite_observation_id': 'source-observation-1',
        'notes': 'Private field note',
    }

    assert visits_repository.create_visit(visit) == (visit, True)
    assert visits_repository.create_visit(visit) == (visit, False)
    assert len(visits_repository.list_visits('gorongosa')) == 1
    stored_observations = fire_repository.list_records(limit=None)
    assert [record['observation_id'] for record in stored_observations] == ['source-observation-1']
    assert 'notes' not in stored_observations[0]


def test_generated_report_never_includes_private_field_visit_notes(tmp_path, monkeypatch) -> None:
    fire_repository = FireRepository(tmp_path / 'observations.sqlite3')
    private_repository = FieldVisitRepository(tmp_path / 'field_visits.sqlite3')
    park = next(park for park in list_parks() if park['id'] == 'gorongosa')
    geometry = park['geometry']
    polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
    longitude, latitude = polygon[0][0]
    fire_repository.replace_source('VIIRS_SNPP_NRT', [{
        'observation_id': 'public-satellite-observation',
        'acquisition_date': '2026-03-01',
        'latitude': latitude,
        'longitude': longitude,
        'instrument': 'VIIRS',
        'feed': 'VIIRS_SNPP_NRT',
        'source': 'NASA FIRMS',
    }])
    private_repository.create_visit({
        'client_id': 'private-visit-123',
        'park_id': 'gorongosa',
        'form_created_at_utc': '2026-03-01T08:00:00+00:00',
        'updated_at_utc': '2026-03-01T08:00:00+00:00',
        'notes': 'Private patrol coordinates and ranger notes',
    })
    monkeypatch.setattr(reports_endpoint, 'fire_repository', fire_repository)

    response = TestClient(app).post('/api/v1/reports/generate', json={'park_id': 'gorongosa'})

    assert response.status_code == 200
    body = response.json()
    assert body['record_count'] == 1
    assert 'public-satellite-observation' in body['csv_export']
    assert 'Private patrol coordinates' not in body['csv_export']
    assert 'Private patrol coordinates' not in body['geojson_export']


def test_park_alert_geofence_uses_park_geometry() -> None:
    watchlist = {'geofence_type': 'park', 'park_id': 'gorongosa'}
    park = next(park for park in list_parks() if park['id'] == 'gorongosa')
    geometry = park['geometry']
    polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
    longitude, latitude = polygon[0][0]
    assert AlertService._inside_geofence(
        {'longitude': longitude, 'latitude': latitude},
        watchlist,
    )
    assert not AlertService._inside_geofence(
        {'longitude': 0, 'latitude': 0},
        watchlist,
    )


def test_field_visit_api_saves_linked_and_manual_reports_without_unlock_key(tmp_path, monkeypatch) -> None:
    fire_repository = FireRepository(tmp_path / 'observations.sqlite3')
    visit_repository = FieldVisitRepository(tmp_path / 'private' / 'field_visits.sqlite3')
    park = next(park for park in list_parks() if park['id'] == 'gorongosa')
    geometry = park['geometry']
    polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
    longitude, latitude = polygon[0][0]
    fire_repository.replace_source('VIIRS_SNPP_NRT', [{
        'observation_id': 'firms-observation',
        'acquisition_date': '2026-03-01',
        'acquisition_time': '0830',
        'latitude': latitude,
        'longitude': longitude,
        'instrument': 'VIIRS',
        'feed': 'VIIRS_SNPP_NRT',
        'satellite': 'NOAA-20',
        'source': 'NASA FIRMS',
    }])
    monkeypatch.setattr(field_visits_endpoint, 'fire_repository', fire_repository)
    monkeypatch.setattr(field_visits_endpoint, 'field_visit_repository', visit_repository)
    payload = {
        'client_id': 'client-visit-123',
        'park_id': 'gorongosa',
        'satellite_observation_id': 'firms-observation',
        'satellite_feed': 'VIIRS_SNPP_NRT',
        'form_created_at_utc': '2026-03-01T10:00:00+02:00',
        'status': 'planned',
        'field_latitude': latitude,
        'field_longitude': longitude,
    }

    client = TestClient(app)
    assert client.get('/api/v1/field-visits').status_code == 200
    response = client.post('/api/v1/field-visits', json=payload)
    assert response.status_code == 201
    saved = response.json()['item']
    assert saved['satellite_latitude'] == latitude
    assert saved['field_latitude'] == latitude
    assert saved['form_created_at_utc'] == '2026-03-01T08:00:00Z'
    assert saved['report_reference'].startswith('FW-GOR-2026-')
    listed = client.get('/api/v1/field-visits?park_id=gorongosa')
    assert listed.status_code == 200
    assert len(listed.json()['items']) == 1
    manual = client.post('/api/v1/field-visits', json={
        **payload,
        'client_id': 'client-manual-123',
        'report_reference': None,
        'record_type': 'manual',
        'satellite_observation_id': None,
        'satellite_feed': None,
        'field_latitude': None,
        'field_longitude': None,
        'status': 'completed',
        'observed_result': 'controlled_burn',
        'lead_ranger': 'Ranger Example',
    })
    assert manual.status_code == 201
    manual_record = manual.json()['item']
    assert manual_record['satellite_latitude'] is None
    assert manual_record['report_reference'].startswith('FW-GOR-2026-')
    assert len(client.get('/api/v1/field-visits').json()['items']) == 2

    dispatched: dict[str, object] = {}

    class StubEmailService:
        async def send_field_report(self, recipients, subject, notes, attachments, client_id):
            dispatched.update({
                'recipients': recipients,
                'subject': subject,
                'notes': notes,
                'attachments': attachments,
                'client_id': client_id,
            })
            return {'id': 'email-1', 'status': 'sent', 'recipients': recipients}

    monkeypatch.setattr(field_visits_endpoint, 'alert_service', StubEmailService())
    email_response = client.post('/api/v1/field-visits/client-manual-123/dispatch', json={
        'additional_recipient': 'ranger@example.org',
        'notes': 'Field report summary',
        'attachments': [
            {
                'filename': 'report.pdf',
                'content_type': 'application/pdf',
                'content_base64': 'JVBERi0=',
            },
            {
                'filename': 'report.docx',
                'content_type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'content_base64': 'UEsDBA==',
            },
        ],
    })
    assert email_response.status_code == 200
    assert dispatched['recipients'] == ['firewatch.mz.alertas@gmail.com', 'ranger@example.org']
    assert len(dispatched['attachments']) == 2


def test_field_report_status_is_reflected_in_fire_map_fires_and_dashboard(tmp_path, monkeypatch) -> None:
    fire_repository = FireRepository(tmp_path / 'observations.sqlite3')
    visit_repository = FieldVisitRepository(tmp_path / 'field_visits.sqlite3')
    park = next(park for park in list_parks() if park['id'] == 'gorongosa')
    geometry = park['geometry']
    polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
    longitude, latitude = polygon[0][0]
    record = {
        'observation_id': 'verified-source',
        'acquisition_date': '2026-03-01',
        'latitude': latitude,
        'longitude': longitude,
        'instrument': 'VIIRS',
        'feed': 'VIIRS_SNPP_NRT',
        'source': 'NASA FIRMS',
    }
    fire_repository.replace_source('VIIRS_SNPP_NRT', [record])
    visit_repository.create_visit({
        'client_id': 'verified-report-123',
        'report_reference': 'FW-GOR-2026-AB12',
        'park_id': 'gorongosa',
        'record_type': 'detection',
        'satellite_observation_id': 'verified-source',
        'satellite_feed': 'VIIRS_SNPP_NRT',
        'status': 'completed',
        'observed_result': 'active_fire_signs',
        'form_created_at_utc': '2026-03-01T08:00:00+00:00',
        'updated_at_utc': '2026-03-01T08:00:00+00:00',
    })
    monkeypatch.setattr(fire_map_endpoint, 'fire_repository', fire_repository)
    monkeypatch.setattr(fire_map_endpoint, 'field_visit_repository', visit_repository)
    monkeypatch.setattr(fires_endpoint, 'fire_repository', fire_repository)
    monkeypatch.setattr(fires_endpoint, 'field_visit_repository', visit_repository)
    monkeypatch.setattr(dashboard_endpoint, 'fire_repository', fire_repository)
    monkeypatch.setattr(dashboard_endpoint, 'field_visit_repository', visit_repository)

    client = TestClient(app)
    mapped = client.get('/api/v1/fire-map?park_id=gorongosa').json()['items'][0]
    listed = client.get('/api/v1/fires?park_id=gorongosa').json()['items'][0]
    summary = client.get('/api/v1/dashboard/summary?park_id=gorongosa').json()
    assert mapped['field_verification_status'] == 'completed'
    assert listed['field_report_reference'] == 'FW-GOR-2026-AB12'
    assert summary['field_verified_detections'] == 1


def test_field_report_email_contains_summary_and_both_documents(tmp_path, monkeypatch) -> None:
    import app.services.alerts.service as alerts_service_module

    sent_messages = []

    class StubSMTP:
        def __init__(self, *args, **kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *args):
            return None

        def ehlo(self):
            pass

        def starttls(self, **kwargs):
            pass

        def login(self, username, password):
            pass

        def send_message(self, message):
            sent_messages.append(message)

    monkeypatch.setattr(alerts_service_module.smtplib, 'SMTP', StubSMTP)
    service = AlertService(
        Settings(
            alerts_database_path=str(tmp_path / 'alerts.sqlite3'),
            smtp_host='mail.example.org',
            smtp_from_email='firewatch@example.org',
        ),
        FireRepository(tmp_path / 'observations.sqlite3'),
    )
    status, _ = service._deliver(
        ['firewatch.mz.alertas@gmail.com'],
        'Ficha FW-GOR-2026-AB12',
        'Gorongosa completed: active-fire confirmed',
        [],
        [
            ('report.pdf', b'%PDF-report', 'application/pdf'),
            (
                'report.docx',
                b'PK-report',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            ),
        ],
    )

    assert status == 'sent'
    message = sent_messages[0]
    assert 'active-fire confirmed' in message.get_body(preferencelist=('plain',)).get_content()
    assert [part.get_filename() for part in message.iter_attachments()] == ['report.pdf', 'report.docx']


def test_weekly_calendar_uses_iso_week_year() -> None:
    records = [{
        'acquisition_date': '2021-01-01',
        'instrument': 'VIIRS',
    }]

    assert aggregate_calendar(records, view='weekly') == [{
        'bucket': 'W53-2020',
        'total': 1,
        'modis': 0,
        'viirs': 1,
    }]


def test_firms_sync_errors_do_not_expose_api_key(tmp_path, caplog) -> None:
    api_key = 'private-test-key'
    settings = Settings(firms_map_key=api_key)
    service = LiveSyncService(
        settings,
        FireRepository(tmp_path / 'observations.sqlite3'),
    )

    async def fail_firms_request(source: str, **kwargs) -> list[dict[str, object]]:
        request = httpx.Request('GET', f'https://firms.test/{api_key}/{source}')
        response = httpx.Response(403, request=request)
        raise httpx.HTTPStatusError('NASA rejected request', request=request, response=response)

    async def no_events(client: httpx.AsyncClient) -> list[dict[str, object]]:
        return []

    service.firms.fetch_source = fail_firms_request
    service.eonet.fetch_events = no_events
    telemetry = asyncio.run(service.sync_once())

    assert telemetry['sources']['MODIS_NRT']['message'] == (
        'NASA FIRMS returned HTTP 403.'
    )
    assert api_key not in repr(telemetry)
    assert api_key not in caplog.text


def test_alert_validation_rejects_header_injection_and_invalid_bbox() -> None:
    common = {
        'name': 'Test watchlist',
        'geofence_type': 'bbox',
        'bbox': [-10, -5, 10, 5],
        'recipients': ['fire@example.org'],
    }
    with pytest.raises(ValidationError):
        WatchlistCreate(**common, subject='Alert\r\nBcc: other@example.org')
    with pytest.raises(ValidationError):
        WatchlistCreate(**{**common, 'bbox': [-10, 5, 10, -5]})
    with pytest.raises(ValidationError):
        AlertTestRequest(recipient='bad-address', subject='Test')


def test_geojson_export_keeps_geometry_and_event_provenance() -> None:
    records = [{
        'observation_id': 'EONET_1:0',
        'latitude': 20.0,
        'longitude': 10.0,
        'instrument': 'EONET',
        'event_id': 'EONET_1',
        'geometry': {
            'type': 'Point',
            'coordinates': [10.0, 20.0],
            'date': '2026-03-01T00:00:00Z',
        },
    }]

    feature_collection = json.loads(build_geojson(records))

    assert feature_collection['features'][0]['geometry'] == {
        'type': 'Point',
        'coordinates': [10.0, 20.0],
    }
    assert feature_collection['features'][0]['properties']['event_id'] == 'EONET_1'


def test_planetary_computer_builds_valid_multiband_tile_query() -> None:
    assets = {
        name: {'href': f'https://example.org/{name}.tif', 'roles': ['data']}
        for name in ('B02', 'B03', 'B04')
    }
    item = PlanetaryComputerClient._item_summary({
        'id': 'sentinel-item',
        'collection': 'sentinel-2-l2a',
        'properties': {},
        'assets': assets,
        'links': [],
    })

    template = item['tile_url_template']
    assert template is not None
    assert '&assets=B04&assets=B03&assets=B02' in template
    assert '&color_formula=Gamma+RGB+3.0' in template
