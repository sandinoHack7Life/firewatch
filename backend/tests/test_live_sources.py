import asyncio
import json
from datetime import date

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.v1.endpoints import (
    calendar as calendar_endpoint,
    field_visits as field_visits_endpoint,
    fire_map as fire_map_endpoint,
    reports as reports_endpoint,
)
from app.core.config import Settings
from app.core.field_access import has_valid_field_access_key
from app.repositories.field_visit_repository import FieldVisitRepository
from app.repositories.fire_repository import FireRepository
from app.schemas.alerts import TestAlertRequest as AlertTestRequest
from app.schemas.alerts import WatchlistCreate
from app.schemas.field_visit import FieldVisitPayload
from app.services.alerts.service import AlertService
from app.services.calendar.service import aggregate_calendar
from app.services.firms.client import FIRMSClient
from app.services.firms.eonet import EONETClient
from app.services.parks.registry import (
    MOZAMBIQUE_FIRMS_BBOX,
    intersect_bboxes,
    list_parks,
    point_in_park,
)
from app.services.planetary_computer.client import PlanetaryComputerClient
from app.services.reports.service import build_geojson
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


def test_park_registry_contains_all_mapped_parks_and_filters_points() -> None:
    parks = list_parks()

    assert [park['id'] for park in parks] == [
        'gorongosa', 'limpopo', 'banhine', 'zinave',
        'bazaruto', 'maputo', 'magoe', 'quirimbas',
    ]
    for park in parks:
        geometry = park['geometry']
        polygon = geometry['coordinates'][0] if geometry['type'] == 'MultiPolygon' else geometry['coordinates']
        longitude, latitude = polygon[0][0]
        assert point_in_park(longitude, latitude, park['id'])
        assert park['boundary_license'] == 'ODbL-1.0'
    assert not point_in_park(0, 0, 'gorongosa')


def test_park_bbox_non_intersection_is_not_a_global_query() -> None:
    assert intersect_bboxes((30, -27, 31, -26), (32, -20, 35, -17)) is None
    assert intersect_bboxes((30, -20, 35, -15), (32, -18, 38, -12)) == (32, -18, 35, -15)


def test_park_endpoints_return_empty_for_non_intersecting_bbox(monkeypatch) -> None:
    class UnexpectedRepository:
        def list_records(self, **kwargs):
            raise AssertionError('A non-intersecting park query must not load global observations.')

    repository = UnexpectedRepository()
    monkeypatch.setattr(fire_map_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(calendar_endpoint, 'fire_repository', repository)
    monkeypatch.setattr(reports_endpoint, 'fire_repository', repository)
    client = TestClient(app)

    fire_map = client.get('/api/v1/fire-map?park_id=gorongosa&bbox=0,0,1,1')
    calendar = client.get('/api/v1/calendar?park_id=gorongosa&bbox=0,0,1,1')
    report = client.post('/api/v1/reports/generate', json={
        'park_id': 'gorongosa',
        'bbox': [0, 0, 1, 1],
    })

    assert fire_map.status_code == 200 and fire_map.json()['items'] == []
    assert calendar.status_code == 200 and calendar.json()['items'] == []
    assert report.status_code == 200 and report.json()['record_count'] == 0


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


def test_field_shared_key_and_park_alert_geofence() -> None:
    assert has_valid_field_access_key('x' * 32, 'x' * 32)
    assert not has_valid_field_access_key('x' * 32, 'wrong')
    assert not has_valid_field_access_key('short', 'short')
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


def test_field_visit_api_protects_records_and_accepts_real_firms_source(tmp_path, monkeypatch) -> None:
    access_key = 'private-field-access-key-' + ('x' * 32)
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
    monkeypatch.setattr(
        field_visits_endpoint,
        'get_settings',
        lambda: Settings(field_data_access_key=access_key),
    )
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
    assert client.get('/api/v1/field-visits').status_code == 403
    response = client.post(
        '/api/v1/field-visits',
        json=payload,
        headers={'X-Field-Data-Key': access_key},
    )
    assert response.status_code == 201
    saved = response.json()['item']
    assert saved['satellite_latitude'] == latitude
    assert saved['field_latitude'] == latitude
    assert saved['form_created_at_utc'] == '2026-03-01T08:00:00Z'
    listed = client.get(
        '/api/v1/field-visits?park_id=gorongosa',
        headers={'X-Field-Data-Key': access_key},
    )
    assert listed.status_code == 200
    assert len(listed.json()['items']) == 1
    assert client.get(
        '/api/v1/field-visits',
        headers={'X-Field-Data-Key': 'wrong'},
    ).status_code == 403


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
        'NASA FIRMS request failed (HTTPStatusError).'
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
