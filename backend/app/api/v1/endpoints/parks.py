from fastapi import APIRouter

from app.services.parks.registry import list_parks

router = APIRouter()


@router.get('/parks')
def parks() -> dict[str, object]:
    return {
        'items': list_parks(),
        'boundary_source': 'OpenStreetMap',
        'boundary_license': 'ODbL-1.0',
    }
