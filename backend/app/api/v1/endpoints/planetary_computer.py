from datetime import date, timedelta

from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings
from app.api.v1.endpoints.park_scope import DEFAULT_PARK_ID, bbox_for_scope
from app.services.planetary_computer.client import (
    DEFAULT_COLLECTIONS,
    PlanetaryComputerClient,
)

router = APIRouter()
client = PlanetaryComputerClient(get_settings().planetary_computer_stac_url)


@router.get('/planetary-computer/search')
async def planetary_computer_search(
    bbox: str = Query(description='west,south,east,north in WGS84'),
    start_date: date = Query(default_factory=lambda: date.today() - timedelta(days=30)),
    end_date: date = Query(default_factory=date.today),
    collections: str | None = Query(default=None),
    limit: int = Query(default=30, ge=1, le=100),
    park_id: str = Query(default=DEFAULT_PARK_ID),
) -> dict[str, object]:
    try:
        coordinates = tuple(float(value) for value in bbox.split(','))
        if len(coordinates) != 4:
            raise ValueError('bbox must contain four coordinates')
        west, south, east, north = coordinates
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError('bbox coordinates are outside valid WGS84 bounds')
        if start_date > end_date:
            raise ValueError('start_date must be on or before end_date')
        selected = [value.strip() for value in collections.split(',')] if collections else list(DEFAULT_COLLECTIONS)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    scoped_bbox, empty_intersection = bbox_for_scope((west, south, east, north), park_id)
    if empty_intersection:
        return {
            'items': [],
            'count': 0,
            'collections': selected,
            'source': 'Microsoft Planetary Computer STAC',
        }
    try:
        items = await client.search(
            bbox=scoped_bbox,
            start_date=start_date,
            end_date=end_date,
            collections=selected,
            limit=limit,
        )
    except Exception as error:
        raise HTTPException(
            status_code=502,
            detail=f'Microsoft Planetary Computer STAC request failed: {error}',
        ) from error
    return {
        'items': items,
        'count': len(items),
        'collections': selected,
        'source': 'Microsoft Planetary Computer STAC',
    }
