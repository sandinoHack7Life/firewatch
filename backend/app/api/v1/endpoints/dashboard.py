from fastapi import APIRouter, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.container import field_visit_repository, fire_repository
from app.services.field_verification import verified_detection_count
from app.services.analytics.service import (
    build_diurnal_overpasses,
    build_frp_histogram,
    build_sensor_comparison,
    build_trend_series,
)
from app.api.v1.endpoints.park_scope import DEFAULT_PARK_ID, list_scoped_records

router = APIRouter()


@router.get('/dashboard/summary')
def dashboard_summary(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    park_id: str | None = Query(default=None),
) -> dict[str, object]:
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=park_id,
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        limit=None,
    )
    summary = fire_repository.get_summary(records)
    visits = field_visit_repository.list_visits(park_id or DEFAULT_PARK_ID)
    comparison = build_sensor_comparison(records)
    trend = build_trend_series(records)
    recent_activity = trend[-7:]
    return {
        'total_detections': summary['total_detections'],
        'modis_detections': summary['modis_detections'],
        'viirs_detections': summary['viirs_detections'],
        'eonet_events': summary['eonet_events'],
        'field_verified_detections': verified_detection_count(records, visits),
        'recent_activity': recent_activity,
        'selected_area': summary['selected_area'],
        'selected_period': summary['selected_period'],
        'sensor_comparison': comparison,
        'source_note': summary['source_note'],
        'data_retrieval_note': summary['source_note'],
        'source_counts': summary['source_counts'],
        'frp_distribution': build_frp_histogram(records),
        'diurnal_overpasses': build_diurnal_overpasses(records),
    }
