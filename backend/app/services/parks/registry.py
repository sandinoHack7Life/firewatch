from __future__ import annotations

import json
import math
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterator

MOZAMBIQUE_FIRMS_BBOX = (30.2, -26.9, 40.9, -10.4)
PARK_BOUNDARIES_FILE = (
    Path(__file__).resolve().parents[2] / 'data' / 'mozambique_national_parks.geojson'
)
PARK_IDS = (
    'gorongosa',
    'limpopo',
    'banhine',
    'zinave',
    'bazaruto',
    'maputo',
    'magoe',
    'quirimbas',
)


def _boundary_note(park_id: str) -> str:
    note = 'Mapped boundary; verify with park authorities before operational dispatch.'
    if park_id == 'bazaruto':
        return f'{note} The available mapped geometry is coarse and may be incomplete.'
    return note


@lru_cache(maxsize=1)
def _features() -> dict[str, dict[str, Any]]:
    with PARK_BOUNDARIES_FILE.open(encoding='utf-8') as source_file:
        collection = json.load(source_file)
    if collection.get('type') != 'FeatureCollection':
        raise RuntimeError('Mozambique park boundary data is not a GeoJSON FeatureCollection.')
    features = {
        str(feature.get('properties', {}).get('id')): feature
        for feature in collection.get('features', [])
    }
    if set(features) != set(PARK_IDS):
        raise RuntimeError('Mozambique park boundary data must contain exactly the eight supported parks.')
    for park_id, feature in features.items():
        if feature.get('geometry', {}).get('type') not in {'Polygon', 'MultiPolygon'}:
            raise RuntimeError(f'Park boundary geometry is missing or invalid for {park_id}.')
    return features


def _coordinates(value: Any) -> Iterator[tuple[float, float]]:
    if (
        isinstance(value, (list, tuple))
        and len(value) >= 2
        and isinstance(value[0], (int, float))
        and isinstance(value[1], (int, float))
    ):
        yield float(value[0]), float(value[1])
        return
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _coordinates(item)


def _bounds(feature: dict[str, Any]) -> tuple[float, float, float, float]:
    coordinates = list(_coordinates(feature['geometry']['coordinates']))
    if not coordinates:
        raise RuntimeError(f'Park boundary has no coordinates: {feature["id"]}.')
    longitudes, latitudes = zip(*coordinates, strict=True)
    return min(longitudes), min(latitudes), max(longitudes), max(latitudes)


def list_parks() -> list[dict[str, Any]]:
    return [
        {
            'id': park_id,
            'name': _features()[park_id]['properties']['name'],
            'province': _features()[park_id]['properties']['province'],
            'geometry': _features()[park_id]['geometry'],
            'bbox': _bounds(_features()[park_id]),
            'boundary_source': 'OpenStreetMap',
            'boundary_license': 'ODbL-1.0',
            'boundary_url': _features()[park_id]['properties']['source_url'],
            'boundary_note': _boundary_note(park_id),
        }
        for park_id in PARK_IDS
    ]


def get_park(park_id: str) -> dict[str, Any]:
    try:
        feature = _features()[park_id]
    except KeyError as error:
        raise KeyError(f'Unsupported Mozambique park: {park_id}') from error
    return {
        **feature['properties'],
        'geometry': feature['geometry'],
        'bbox': _bounds(feature),
        'boundary_source': 'OpenStreetMap',
        'boundary_license': 'ODbL-1.0',
        'boundary_note': _boundary_note(park_id),
    }


def _point_in_ring(longitude: float, latitude: float, ring: list[list[float]]) -> bool:
    inside = False
    if len(ring) < 3:
        return False
    for first, second in zip(ring, ring[1:] + ring[:1], strict=True):
        x1, y1 = float(first[0]), float(first[1])
        x2, y2 = float(second[0]), float(second[1])
        cross = (longitude - x1) * (y2 - y1) - (latitude - y1) * (x2 - x1)
        if (
            abs(cross) <= 1e-10
            and min(x1, x2) - 1e-10 <= longitude <= max(x1, x2) + 1e-10
            and min(y1, y2) - 1e-10 <= latitude <= max(y1, y2) + 1e-10
        ):
            return True
        if (y1 > latitude) != (y2 > latitude):
            crossing = x1 + (latitude - y1) * (x2 - x1) / (y2 - y1)
            if longitude < crossing:
                inside = not inside
    return inside


def _point_in_polygon(longitude: float, latitude: float, rings: list[list[list[float]]]) -> bool:
    return bool(
        rings
        and _point_in_ring(longitude, latitude, rings[0])
        and not any(_point_in_ring(longitude, latitude, hole) for hole in rings[1:])
    )


def point_in_park(longitude: float, latitude: float, park_id: str) -> bool:
    if not math.isfinite(longitude) or not math.isfinite(latitude):
        return False
    if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
        return False
    geometry = get_park(park_id)['geometry']
    if geometry['type'] == 'Polygon':
        return _point_in_polygon(longitude, latitude, geometry['coordinates'])
    return any(
        _point_in_polygon(longitude, latitude, polygon)
        for polygon in geometry['coordinates']
    )


def park_bbox(park_id: str) -> tuple[float, float, float, float]:
    return get_park(park_id)['bbox']


def intersect_bboxes(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> tuple[float, float, float, float] | None:
    west = max(first[0], second[0])
    south = max(first[1], second[1])
    east = min(first[2], second[2])
    north = min(first[3], second[3])
    return (west, south, east, north) if west < east and south < north else None


def filter_records_by_park(
    records: list[dict[str, Any]],
    park_id: str,
) -> list[dict[str, Any]]:
    return [
        record
        for record in records
        if point_in_park(
            float(record['longitude']),
            float(record['latitude']),
            park_id,
        )
    ]
