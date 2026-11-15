from fastapi import APIRouter

from app.services.runtime import sync_service

router = APIRouter()


@router.get('/data-sources')
def data_sources() -> dict[str, object]:
    return {
        'sync_status': sync_service.telemetry(),
        'sources': [
            {
                'name': 'NASA FIRMS',
                'provider': 'NASA / Land, Atmosphere Near Real-Time Capability for EO (LANCE) / FIRMS',
                'instrument': 'MODIS and VIIRS thermal anomaly detections',
                'product_id': 'MOD14A1, MYD14A1, VNP14IMGTDL_NRT, VJ114IMGTDL_NRT',
                'processing_type': 'standard and near-real-time streams',
                'availability': 'Direct NRT CSV streams activate when FIRMS_MAP_KEY is configured. No observations are fabricated when it is absent.',
                'feeds': {
                    feed: sync_service.source_status.get(feed, {
                        'status': 'credentials_required',
                        'message': 'Configure FIRMS_MAP_KEY to enable this feed.',
                        'record_count': 0,
                    })
                    for feed in ('MODIS_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT')
                },
                'documentation': [
                    'https://firms.modaps.eosdis.nasa.gov/',
                    'https://firms.modaps.eosdis.nasa.gov/api/',
                    'https://firms.modaps.eosdis.nasa.gov/content/active_fire/',
                ],
            },
            {
                'name': 'NASA EONET',
                'provider': 'NASA Earth Observatory Natural Event Tracker',
                'instrument': 'Open wildfire event catalog; not a satellite hotspot or FRP feed',
                'endpoint': 'https://eonet.gsfc.nasa.gov/api/v3/events?category=wildfires&status=open',
                'availability': sync_service.source_status.get('NASA_EONET', {}).get('status', 'starting'),
                'status': sync_service.source_status.get('NASA_EONET', {}),
                'documentation': ['https://eonet.gsfc.nasa.gov/docs/v3'],
            },
            {
                'name': 'Microsoft Planetary Computer STAC',
                'provider': 'Microsoft Planetary Computer / NASA LP DAAC / ESA / USGS',
                'collections': [
                    'modis-14A1-061',
                    'modis-14A2-061',
                    'sentinel-2-l2a',
                    'landsat-c2-l2',
                ],
                'endpoint': 'https://planetarycomputer.microsoft.com/api/stac/v1',
                'availability': 'Public STAC API; queried for item metadata and imagery assets on request.',
            },
        ]
    }
