from fastapi import APIRouter, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.api.v1.endpoints.park_scope import list_scoped_records
from app.container import fire_repository
from app.services.calendar.service import aggregate_calendar

router = APIRouter()


@router.get('/calendar')
def calendar_view(
    view: str = Query(default='daily'),
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
        'view': view,
        'items': aggregate_calendar(records, view=view),
        'sensor': sensor,
        'source': sorted({str(record.get('source')) for record in records}),
    }
