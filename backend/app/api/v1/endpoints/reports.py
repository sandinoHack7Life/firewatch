from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.api.v1.endpoints.park_scope import list_scoped_records
from app.container import fire_repository
from app.schemas.fire import ReportRequest
from app.services.reports.service import build_csv_export, build_geojson, generate_report_summary

router = APIRouter()


@router.get('/reports')
def list_reports(
    park_id: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
) -> dict[str, object]:
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=park_id,
        bbox=parse_bbox(bbox),
        start_date=start_date,
        end_date=end_date,
    )
    return {
        'reports': [],
        'stored_reports': False,
        'available_record_count': len(records),
        'source_counts': fire_repository.get_summary(records)['source_counts'],
        'message': 'Generated reports are returned immediately and are not persisted.',
    }


@router.post('/reports/generate')
def generate_report(payload: ReportRequest) -> dict[str, object]:
    if payload.bbox is not None and (
        len(payload.bbox) != 4
        or not (
            -180 <= payload.bbox[0] < payload.bbox[2] <= 180
            and -90 <= payload.bbox[1] < payload.bbox[3] <= 90
        )
    ):
        raise HTTPException(status_code=422, detail='bbox must be valid [west, south, east, north].')
    bbox = (
        (payload.bbox[0], payload.bbox[1], payload.bbox[2], payload.bbox[3])
        if payload.bbox is not None else None
    )
    if payload.start_date and payload.end_date and payload.start_date > payload.end_date:
        raise HTTPException(status_code=422, detail='start_date must be on or before end_date.')
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=payload.park_id,
        bbox=bbox,
        sensors=[s for s in payload.sensors if s],
        start_date=payload.start_date,
        end_date=payload.end_date,
        min_frp=payload.min_frp,
        search=payload.search,
    )
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
