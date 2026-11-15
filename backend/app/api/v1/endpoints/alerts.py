from fastapi import APIRouter, HTTPException, Query

from app.api.v1.endpoints.park_scope import DEFAULT_PARK_ID, require_registered_park
from app.schemas.alerts import TestAlertRequest, WatchlistCreate, WatchlistUpdate
from app.services.parks.registry import filter_records_by_park
from app.services.runtime import alert_service

router = APIRouter()


@router.get('/alerts')
def list_watchlists(
    park_id: str = Query(default=DEFAULT_PARK_ID),
) -> dict[str, object]:
    require_registered_park(park_id)
    watchlists = alert_service.list_watchlists()
    return {
        'watchlists': [
            item
            for item in watchlists
            if item.get('geofence_type') != 'park' or item.get('park_id') == park_id
        ],
    }


def _validate_watchlist_park(payload: WatchlistCreate | WatchlistUpdate) -> None:
    if payload.geofence_type == 'park' and payload.park_id is not None:
        require_registered_park(payload.park_id)


@router.post('/alerts', status_code=201)
def create_watchlist(payload: WatchlistCreate) -> dict[str, object]:
    _validate_watchlist_park(payload)
    return {'watchlist': alert_service.create_watchlist(payload)}


@router.get('/alerts/history')
def dispatch_history(
    limit: int = Query(default=100, ge=1, le=500),
    park_id: str = Query(default=DEFAULT_PARK_ID),
) -> dict[str, object]:
    items = alert_service.list_history(limit)
    require_registered_park(park_id)
    scoped_items = []
    for item in items:
        matches = filter_records_by_park(item['matched_observations'], park_id)
        if matches:
            scoped_items.append({**item, 'matched_observations': matches})
    return {'items': scoped_items}


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
    _validate_watchlist_park(payload)
    item = alert_service.update_watchlist(watchlist_id, payload)
    if item is None:
        raise HTTPException(status_code=404, detail='Watchlist not found.')
    return {'watchlist': item}


@router.delete('/alerts/{watchlist_id}', status_code=204)
def delete_watchlist(watchlist_id: str) -> None:
    if not alert_service.delete_watchlist(watchlist_id):
        raise HTTPException(status_code=404, detail='Watchlist not found.')
