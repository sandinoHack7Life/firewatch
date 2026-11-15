from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx


def _geometry_point(geometry: dict[str, Any]) -> tuple[float, float] | None:
    coordinates = geometry.get('coordinates')
    geometry_type = geometry.get('type')
    if not isinstance(coordinates, list) or not coordinates:
        return None
    if geometry_type == 'Point' and len(coordinates) >= 2:
        return float(coordinates[0]), float(coordinates[1])

    points: list[tuple[float, float]] = []
    stack: list[Any] = [coordinates]
    while stack:
        value = stack.pop()
        if (
            isinstance(value, list)
            and len(value) >= 2
            and isinstance(value[0], (float, int))
            and isinstance(value[1], (float, int))
        ):
            points.append((float(value[0]), float(value[1])))
        elif isinstance(value, list):
            stack.extend(value)
    if not points:
        return None
    return (
        sum(point[0] for point in points) / len(points),
        sum(point[1] for point in points) / len(points),
    )


class EONETClient:
    """Zero-key access to NASA EONET's currently open wildfire event catalog."""

    def __init__(self, api_url: str) -> None:
        self.api_url = api_url

    async def fetch_events(
        self,
        client: httpx.AsyncClient | None = None,
    ) -> list[dict[str, Any]]:
        if client is None:
            async with httpx.AsyncClient(timeout=30.0) as owned_client:
                response = await owned_client.get(
                    self.api_url,
                    params={'category': 'wildfires', 'status': 'open', 'limit': 500},
                )
        else:
            response = await client.get(
                self.api_url,
                params={'category': 'wildfires', 'status': 'open', 'limit': 500},
            )
        response.raise_for_status()
        payload = response.json()
        records: list[dict[str, Any]] = []
        for event in payload.get('events', []):
            event_id = str(event.get('id') or '')
            geometries = event.get('geometry') or []
            if not event_id or not isinstance(geometries, list):
                continue
            for index, geometry in enumerate(geometries):
                if not isinstance(geometry, dict):
                    continue
                point = _geometry_point(geometry)
                if point is None:
                    continue
                timestamp = geometry.get('date') or event.get('closed')
                if not timestamp:
                    continue
                acquired = datetime.fromisoformat(str(timestamp).replace('Z', '+00:00'))
                if acquired.tzinfo is None:
                    acquired = acquired.replace(tzinfo=timezone.utc)
                sources = event.get('sources') or []
                source_url = sources[0].get('url') if sources and isinstance(sources[0], dict) else None
                records.append({
                    'observation_id': f'{event_id}:{index}:{acquired.isoformat()}',
                    'latitude': point[1],
                    'longitude': point[0],
                    'acquisition_date': acquired.date().isoformat(),
                    'acquisition_time': acquired.strftime('%H%M'),
                    'satellite': 'Not satellite-derived',
                    'instrument': 'EONET',
                    'product': 'NASA EONET wildfire event',
                    'brightness_temperature': None,
                    'brightness_temperature_2': None,
                    'frp': None,
                    'confidence': None,
                    'day_night': None,
                    'processing_type': 'Open event',
                    'source': 'NASA EONET',
                    'original_source': 'NASA EONET',
                    'feed': 'NASA_EONET',
                    'event_id': event_id,
                    'event_title': event.get('title'),
                    'event_url': event.get('link'),
                    'event_source_url': source_url,
                    'event_magnitude': geometry.get('magnitudeValue'),
                    'event_magnitude_unit': geometry.get('magnitudeUnit'),
                    'geometry': geometry,
                })
        return records
