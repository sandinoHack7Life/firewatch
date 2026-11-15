from __future__ import annotations

from datetime import date
from typing import Any

import httpx


DEFAULT_COLLECTIONS = (
    'modis-14A1-061',
    'modis-14A2-061',
    'sentinel-2-l2a',
    'landsat-c2-l2',
)
PREVIEW_ASSETS = ('rendered_preview', 'visual', 'thumbnail', 'preview')


class PlanetaryComputerClient:
    """Queries public Microsoft Planetary Computer STAC item metadata."""

    def __init__(self, stac_url: str) -> None:
        self.stac_url = stac_url.rstrip('/')

    async def search(
        self,
        *,
        bbox: tuple[float, float, float, float],
        start_date: date,
        end_date: date,
        collections: list[str] | None = None,
        limit: int = 40,
        client: httpx.AsyncClient | None = None,
    ) -> list[dict[str, Any]]:
        selected = collections or list(DEFAULT_COLLECTIONS)
        invalid = sorted(set(selected) - set(DEFAULT_COLLECTIONS))
        if invalid:
            raise ValueError(f'Unsupported Planetary Computer collections: {", ".join(invalid)}')
        body = {
            'collections': selected,
            'bbox': list(bbox),
            'datetime': f'{start_date.isoformat()}T00:00:00Z/{end_date.isoformat()}T23:59:59Z',
            'limit': min(max(limit, 1), 100),
        }
        if client is None:
            async with httpx.AsyncClient(timeout=45.0) as owned_client:
                response = await owned_client.post(f'{self.stac_url}/search', json=body)
        else:
            response = await client.post(f'{self.stac_url}/search', json=body)
        response.raise_for_status()
        payload = response.json()
        return [self._item_summary(item) for item in payload.get('features', [])]

    @staticmethod
    def _item_summary(item: dict[str, Any]) -> dict[str, Any]:
        properties = item.get('properties') or {}
        collection = str(item.get('collection') or '')
        item_id = str(item.get('id') or '')
        assets = item.get('assets') or {}
        preview = item.get('links', [])
        preview_link = next(
            (link.get('href') for link in preview if link.get('rel') in {'preview', 'rendered_preview'}),
            None,
        )
        data_assets = [
            name
            for name, asset in assets.items()
            if 'data' in asset.get('roles', [])
        ]
        rgb_assets = ('B04', 'B03', 'B02')
        if all(name in data_assets for name in rgb_assets):
            tile_assets = list(rgb_assets)
        elif data_assets:
            tile_assets = [data_assets[0]]
        else:
            tile_assets = []
        tile_url_template = None
        if tile_assets:
            asset_query = ''.join(f'&assets={name}' for name in tile_assets)
            color_query = '&color_formula=Gamma+RGB+3.0' if len(tile_assets) == 3 else ''
            tile_url_template = (
                'https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/'
                'WebMercatorQuad/{z}/{x}/{y}?'
                f'collection={collection}&item={item_id}{asset_query}{color_query}'
            )
        asset_links = {
            name: asset.get('href')
            for name, asset in assets.items()
            if asset.get('href') and (
                name in PREVIEW_ASSETS or 'data' in asset.get('roles', [])
            )
        }
        preview_link = preview_link or next(
            (asset_links.get(name) for name in PREVIEW_ASSETS if asset_links.get(name)),
            None,
        )
        return {
            'id': item_id,
            'collection': collection,
            'datetime': properties.get('datetime') or properties.get('start_datetime'),
            'platform': properties.get('platform'),
            'instruments': properties.get('instruments'),
            'cloud_cover': properties.get('eo:cloud_cover'),
            'geometry': item.get('geometry'),
            'bbox': item.get('bbox'),
            'preview_url': preview_link,
            'tile_url_template': tile_url_template,
            'assets': asset_links,
            'item_url': next(
                (link.get('href') for link in item.get('links', []) if link.get('rel') == 'self'),
                None,
            ),
            'provenance': 'Microsoft Planetary Computer STAC',
        }
