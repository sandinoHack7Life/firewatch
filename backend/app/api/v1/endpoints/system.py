from fastapi import APIRouter

from app.services.runtime import sync_service

router = APIRouter()


@router.get('/system/telemetry')
def telemetry() -> dict[str, object]:
    return sync_service.telemetry()


@router.post('/system/sync')
async def synchronize_now() -> dict[str, object]:
    return await sync_service.sync_once()
