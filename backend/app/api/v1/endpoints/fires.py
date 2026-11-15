from fastapi import APIRouter, HTTPException, Query

from app.api.v1.endpoints.park_scope import (
    DEFAULT_PARK_ID,
    list_scoped_records,
    require_registered_park,
)
from app.container import field_visit_repository, fire_repository
from app.services.field_verification import annotate_observations
from app.services.parks.registry import filter_records_by_park

router = APIRouter()


def parse_bbox(value: str | None) -> tuple[float, float, float, float] | None:
    if not value:
        return None
    try:
        coordinates = tuple(float(part) for part in value.split(','))
        if len(coordinates) != 4:
            raise ValueError
        west, south, east, north = coordinates
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError
        return west, south, east, north
    except ValueError as error:
        raise HTTPException(
            status_code=422,
            detail='bbox must be west,south,east,north in valid WGS84 bounds.',
        ) from error


@router.get('/fires')
def list_fires(
    sensor: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=200),
    search: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
    min_frp: float | None = Query(default=None, ge=0),
    park_id: str | None = Query(default=None),
) -> dict[str, object]:
    records = list_scoped_records(
        fire_repository.list_records,
        park_id=park_id,
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        min_frp=min_frp,
        search=search,
        limit=None,
    )
    selected_park_id = park_id or DEFAULT_PARK_ID
    records = annotate_observations(
        records,
        field_visit_repository.list_visits(selected_park_id),
    )
    total = len(records)
    start = (page - 1) * page_size
    end = start + page_size
    return {
        'items': records[start:end],
        'total': total,
        'page': page,
        'page_size': page_size,
        'source': sorted({str(record.get('source')) for record in records}),
    }


@router.get('/fires/{observation_id}')
def fire_detail(
    observation_id: str,
    park_id: str = Query(default=DEFAULT_PARK_ID),
) -> dict[str, object]:
    require_registered_park(park_id)
    item = fire_repository.get_record(observation_id)
    if item is None:
        raise HTTPException(status_code=404, detail='Observation not found.')
    if not filter_records_by_park([item], park_id):
        raise HTTPException(status_code=404, detail='Observation not found in the selected park.')
    item = annotate_observations(
        [item],
        field_visit_repository.list_visits(park_id),
    )[0]
    return {'item': item, 'source': item.get('source')}
