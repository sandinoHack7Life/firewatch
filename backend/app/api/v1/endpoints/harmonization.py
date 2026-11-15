from fastapi import APIRouter, Query

from app.api.v1.endpoints.fires import parse_bbox
from app.container import fire_repository
from app.services.harmonization.engine import build_potential_matches, harmonization_summary

router = APIRouter()


@router.get('/harmonization/summary')
def harmonization_summary_endpoint(
    sensor: str | None = Query(default=None),
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
) -> dict[str, object]:
    records = fire_repository.list_records(
        sensors=[sensor] if sensor else None,
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        limit=None,
    )
    return harmonization_summary(records)


@router.get('/harmonization/matches')
def harmonization_matches(
    start_date: str | None = Query(default=None),
    end_date: str | None = Query(default=None),
    bbox: str | None = Query(default=None),
) -> dict[str, object]:
    records = fire_repository.list_records(
        start_date=start_date,
        end_date=end_date,
        bbox=parse_bbox(bbox),
        limit=None,
    )
    return {'matches': build_potential_matches(records), 'source': 'NASA FIRMS'}
