from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.container import fire_repository
from app.schemas.fire import ReportRequest
from app.services.reports.service import build_csv_export, build_geojson, generate_report_summary
from app.services.parks.registry import (
    filter_records_by_park,
    get_park,
    intersect_bboxes,
    park_bbox,
)

router = APIRouter()


@router.get('/reports')
def list_reports() -> dict[str, object]:
    records = fire_repository.list_records(limit=None)
    return {
        'reports': [],
        'stored_reports': False,
        'available_record_count': len(records),
        'source_counts': fire_repository.get_summary(records)['source_counts'],
        'message': 'Generated reports are returned immediately and are not persisted.',
    }


@router.post('/reports/generate')
def generate_report(payload: ReportRequest) -> dict[str, object]:
    bbox = tuple(payload.bbox) if payload.bbox is not None else None
    if bbox is not None and (
        len(bbox) != 4
        or not (-180 <= bbox[0] < bbox[2] <= 180 and -90 <= bbox[1] < bbox[3] <= 90)
    ):
        raise HTTPException(status_code=422, detail='bbox must be valid [west, south, east, north].')
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(status_code=422, detail='start_date must be on or before end_date.')
    empty_intersection = False
    if payload.park_id:
        try:
            park_bounds = park_bbox(payload.park_id)
            get_park(payload.park_id)
        except KeyError as error:
            raise HTTPException(status_code=422, detail='Unsupported national park.') from error
        if bbox:
            bbox = intersect_bboxes(bbox, park_bounds)
            empty_intersection = bbox is None
        else:
            bbox = park_bounds
    records = [] if empty_intersection else fire_repository.list_records(
        sensors=[s for s in payload.sensors if s],
        start_date=payload.start_date,
        end_date=payload.end_date,
        bbox=bbox,
        min_frp=payload.min_frp,
        search=payload.search,
        limit=None,
    )
    if payload.park_id:
        records = filter_records_by_park(records, payload.park_id)
    summary = generate_report_summary(records, payload.region, payload.sensors)
    csv_content = build_csv_export(records)
    geojson_content = build_geojson(records)
    return {
        'generated_at': summary['generated_at'],
        'region': payload.region,
        'sensor_selection': payload.sensors,
        'record_count': len(records),
        'summary': summary,
        'csv_export': csv_content,
        'geojson_export': geojson_content,
        'notes': (
            'CSV and GeoJSON contain NASA observation records only; field verification records '
            'and sensitive team data are never included. Satellite thermal anomalies are not '
            'ground-truth fire confirmation.'
        ),
    }
