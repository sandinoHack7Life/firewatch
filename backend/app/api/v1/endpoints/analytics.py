from fastapi import APIRouter, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.api.v1.endpoints.park_scope import list_scoped_records
from app.container import fire_repository
from app.services.analytics.service import (
    build_anomaly_flags,
    build_diurnal_overpasses,
    build_frp_histogram,
    build_sensor_comparison,
    build_trend_series,
)

router = APIRouter()


@router.get('/analytics/trends')
def trends(
    sensor: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    park_id: str | None = Query(default=None),
) -> dict[str, object]:
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=park_id,
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        limit=None,
    )
    return {'items': build_trend_series(records), 'source': sorted({str(record.get('source')) for record in records})}


@router.get('/analytics/comparison')
def comparison(
    sensor: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    park_id: str | None = Query(default=None),
) -> dict[str, object]:
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=park_id,
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        limit=None,
    )
    return {
        'comparison': build_sensor_comparison(records),
        'frp_distribution': build_frp_histogram(records),
        'diurnal_overpasses': build_diurnal_overpasses(records),
        'source': sorted({str(record.get('source')) for record in records}),
    }


@router.get('/analytics/anomalies')
def anomalies(
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
    return {
        'anomalies': build_anomaly_flags(records),
        'source': sorted({str(record.get('source')) for record in records}),
    }
