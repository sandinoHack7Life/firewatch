from fastapi import APIRouter, HTTPException, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.container import fire_repository
from app.services.calendar.service import aggregate_calendar
from app.services.parks.registry import (
    filter_records_by_park,
    get_park,
    intersect_bboxes,
)

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
    request_bbox = parse_bbox(bbox)
    empty_intersection = False
    if park_id:
        try:
            park_bbox = get_park(park_id)['bbox']
        except KeyError as error:
            raise HTTPException(status_code=422, detail='Unsupported national park.') from error
        if request_bbox:
            request_bbox = intersect_bboxes(request_bbox, park_bbox)
            empty_intersection = request_bbox is None
        else:
            request_bbox = park_bbox
    records = [] if empty_intersection else fire_repository.list_records(
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=request_bbox,
        limit=None,
    )
    if park_id:
        records = filter_records_by_park(records, park_id)
    return {
        'view': view,
        'items': aggregate_calendar(records, view=view),
        'sensor': sensor,
        'source': sorted({str(record.get('source')) for record in records}),
    }
