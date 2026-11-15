from fastapi import APIRouter

router = APIRouter()


@router.get('/health')
def health() -> dict[str, str]:
    return {
        'status': 'ok',
        'service': 'MODIS–VIIRS Firewatch',
        'sources': 'NASA EONET; NASA FIRMS when configured; Microsoft Planetary Computer STAC on request',
    }
