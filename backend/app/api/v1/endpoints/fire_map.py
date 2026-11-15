from fastapi import APIRouter, HTTPException, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.container import fire_repository
from app.services.parks.registry import filter_records_by_park, get_park, intersect_bboxes

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
    request_bbox = parse_bbox(bbox)
    if park_id:
        try:
            park_bbox = get_park(park_id)['bbox']
        except KeyError as error:
            raise HTTPException(status_code=422, detail='Unsupported national park.') from error
        if request_bbox:
            request_bbox = intersect_bboxes(request_bbox, park_bbox)
        else:
            request_bbox = park_bbox
    records = [] if park_id and request_bbox is None else fire_repository.list_records(
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=request_bbox,
        min_frp=min_frp,
        limit=None,
    )
    if park_id and records:
        records = filter_records_by_park(records, park_id)
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
