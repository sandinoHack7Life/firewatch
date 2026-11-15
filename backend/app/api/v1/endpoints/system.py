from fastapi import APIRouter, Query

from app.api.v1.endpoints.park_scope import DEFAULT_PARK_ID, require_registered_park
from app.services.runtime import sync_service

router = APIRouter()


@router.get('/system/telemetry')
def telemetry(park_id: str = Query(default=DEFAULT_PARK_ID)) -> dict[str, object]:
    require_registered_park(park_id)
    return sync_service.telemetry()


@router.post('/system/sync')
async def synchronize_now() -> dict[str, object]:
    return await sync_service.sync_once()
