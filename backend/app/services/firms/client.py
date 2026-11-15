from __future__ import annotations

import csv
import hashlib
import io
from typing import Any
from urllib.parse import quote

import httpx

from app.services.parks.registry import MOZAMBIQUE_FIRMS_BBOX


FIRMS_SOURCES = (
    'MODIS_NRT',
    'VIIRS_SNPP_NRT',
    'VIIRS_NOAA20_NRT',
)


def _number(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return float(value)
    except ValueError:
        return None


def _observation_id(row: dict[str, str | None]) -> str:
    explicit_id = row.get('acq_id') or row.get('id') or row.get('observation_id')
    if explicit_id:
        return str(explicit_id)
    identity = '|'.join(
        str(row.get(key) or '')
        for key in ('latitude', 'longitude', 'acq_date', 'acq_time', 'satellite', 'instrument')
    )
    return hashlib.sha256(identity.encode('utf-8')).hexdigest()[:32]


class FIRMSClient:
    """Fetches NASA FIRMS NRT CSV records when a map key is configured."""

    def __init__(self, api_key: str = '') -> None:
        self.api_key = api_key.strip()

    @staticmethod
    def parse_csv_csv(csv_text: str, feed: str = 'NASA FIRMS') -> list[dict[str, Any]]:
        reader = csv.DictReader(io.StringIO(csv_text))
        results: list[dict[str, Any]] = []
        for row in reader:
            if not row:
                continue
            latitude = _number(row.get('latitude'))
            longitude = _number(row.get('longitude'))
            if latitude is None or longitude is None:
                continue
            instrument = (row.get('instrument') or '').upper()
            source = row.get('source') or feed
            results.append({
                'observation_id': _observation_id(row),
                'latitude': latitude,
                'longitude': longitude,
                'acquisition_date': row.get('acq_date') or row.get('acquisition_date') or '',
                'acquisition_time': row.get('acq_time') or row.get('acquisition_time') or '',
                'satellite': row.get('satellite') or row.get('platform') or 'Unknown',
                'instrument': instrument or ('MODIS' if 'MODIS' in feed else 'VIIRS'),
                'product': row.get('product') or feed,
                'brightness_temperature': _number(row.get('bright_t31') or row.get('brightness_temperature')),
                'brightness_temperature_2': _number(row.get('bright_t37') or row.get('brightness_temperature_2')),
                'frp': _number(row.get('frp')),
                'confidence': row.get('confidence') or None,
                'day_night': row.get('daynight') or row.get('day_night') or 'U',
                'processing_type': row.get('type') or row.get('processing_type') or 'NRT',
                'source': 'NASA FIRMS',
                'original_source': feed,
                'feed': feed,
            })
        return results

    async def fetch_source(
        self,
        source: str,
        day_range: int = 2,
        area: tuple[float, float, float, float] = MOZAMBIQUE_FIRMS_BBOX,
        client: httpx.AsyncClient | None = None,
    ) -> list[dict[str, Any]]:
        if not self.api_key:
            return []
        if source not in FIRMS_SOURCES:
            raise ValueError(f'Unsupported NASA FIRMS source: {source}')

        west, south, east, north = area
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError('NASA FIRMS area must be a valid [west, south, east, north] bbox.')
        area_path = quote(','.join(str(value) for value in area), safe=',')
        url = (
            'https://firms.modaps.eosdis.nasa.gov/api/area/csv/'
            f'{quote(self.api_key, safe="")}/{source}/{area_path}/{day_range}'
        )
        if client is None:
            async with httpx.AsyncClient(timeout=45.0) as owned_client:
                response = await owned_client.get(url)
        else:
            response = await client.get(url)
        response.raise_for_status()
        return self.parse_csv_csv(response.text, source)
