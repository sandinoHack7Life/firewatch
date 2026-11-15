from fastapi import APIRouter, HTTPException, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.api.v1.endpoints.park_scope import DEFAULT_PARK_ID, list_scoped_records
from app.container import field_visit_repository, fire_repository
from app.services.field_verification import annotate_observations

router = APIRouter()


@router.get('/fire-map')
def fire_map(
    sensor: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    park_id: str | None = Query(default=None),
    min_frp: float | None = Query(default=None, ge=0),
    limit: int = Query(default=1000, ge=1, le=5000),
) -> dict[str, object]:
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=park_id,
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        min_frp=min_frp,
        limit=None,
    )
    records = annotate_observations(
        records,
        field_visit_repository.list_visits(park_id or DEFAULT_PARK_ID),
    )
    records = records[:limit]
    return {
        'items': records,
        'count': len(records),
        'legend': {
            'MODIS': 'Thermal anomaly observations from MODIS sensors',
            'VIIRS': 'Thermal anomaly observations from VIIRS sensors',
        },
        'source': sorted({str(record.get('source')) for record in records}),
    }
