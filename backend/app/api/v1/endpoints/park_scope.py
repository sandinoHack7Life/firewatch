from __future__ import annotations

from typing import Any, Callable

from fastapi import HTTPException

from app.services.parks.registry import (
    DEFAULT_PARK_ID,
    filter_records_by_park,
    get_park,
    intersect_bboxes,
    park_bbox,
)

BBox = tuple[float, float, float, float]
RecordList = Callable[..., list[dict[str, Any]]]


def require_registered_park(park_id: str) -> dict[str, Any]:
    try:
        return get_park(park_id)
    except KeyError as error:
        raise HTTPException(
            status_code=400,
            detail='Unknown park_id. Use an ID returned by /api/v1/parks.',
        ) from error


def resolve_park_id(park_id: str | None) -> str:
    selected_park_id = DEFAULT_PARK_ID if park_id is None else park_id
    require_registered_park(selected_park_id)
    return selected_park_id


def bbox_for_scope(
    bbox: BBox | None,
    park_id: str | None,
) -> tuple[BBox, bool]:
    selected_park_id = resolve_park_id(park_id)
    selected_bbox = park_bbox(selected_park_id)
    if bbox is None:
        return selected_bbox, False
    intersection = intersect_bboxes(bbox, selected_bbox)
    return intersection, intersection is None


def list_scoped_records(
    list_records: RecordList,
    *,
    park_id: str | None = None,
    bbox: BBox | None = None,
    sensors: list[str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    min_frp: float | None = None,
    search: str | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    selected_park_id = resolve_park_id(park_id)
    scoped_bbox, empty_intersection = bbox_for_scope(bbox, selected_park_id)
    if empty_intersection:
        return []
    records = list_records(
        sensors=sensors,
        start_date=start_date,
        end_date=end_date,
        bbox=scoped_bbox,
        min_frp=min_frp,
        search=search,
        limit=limit,
    )
    return filter_records_by_park(records, selected_park_id)
