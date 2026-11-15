from fastapi import APIRouter, HTTPException, Query

from app.schemas.alerts import TestAlertRequest, WatchlistCreate, WatchlistUpdate
from app.services.runtime import alert_service

router = APIRouter()


@router.get('/alerts')
def list_watchlists() -> dict[str, object]:
    return {'watchlists': alert_service.list_watchlists()}


@router.post('/alerts', status_code=201)
def create_watchlist(payload: WatchlistCreate) -> dict[str, object]:
    return {'watchlist': alert_service.create_watchlist(payload)}


@router.get('/alerts/history')
def dispatch_history(limit: int = Query(default=100, ge=1, le=500)) -> dict[str, object]:
    return {'items': alert_service.list_history(limit)}


@router.post('/alerts/test')
async def send_test_email(payload: TestAlertRequest) -> dict[str, object]:
    try:
        item = await alert_service.send_test(
            payload.recipient,
            payload.subject,
            payload.notes,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {'item': item}


@router.put('/alerts/{watchlist_id}')
def update_watchlist(
    watchlist_id: str,
    payload: WatchlistUpdate,
) -> dict[str, object]:
    item = alert_service.update_watchlist(watchlist_id, payload)
    if item is None:
        raise HTTPException(status_code=404, detail='Watchlist not found.')
    return {'watchlist': item}


@router.delete('/alerts/{watchlist_id}', status_code=204)
def delete_watchlist(watchlist_id: str) -> None:
    if not alert_service.delete_watchlist(watchlist_id):
        raise HTTPException(status_code=404, detail='Watchlist not found.')
