from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Response

from app.container import field_visit_repository, fire_repository
from app.core.config import get_settings
from app.core.field_access import MIN_FIELD_ACCESS_KEY_LENGTH, has_valid_field_access_key
from app.schemas.field_visit import FieldVisitPayload
from app.services.firms.client import FIRMS_SOURCES
from app.services.parks.registry import get_park, point_in_park

router = APIRouter()


def require_field_access_key(
    x_field_data_key: str | None = Header(default=None, alias='X-Field-Data-Key'),
) -> None:
    configured_key = get_settings().field_data_access_key
    if len(configured_key) < MIN_FIELD_ACCESS_KEY_LENGTH:
        raise HTTPException(
            status_code=503,
            detail='Field visit APIs are disabled until FIELD_DATA_ACCESS_KEY is configured.',
        )
    if not has_valid_field_access_key(configured_key, x_field_data_key):
        raise HTTPException(status_code=403, detail='Field data access key is invalid.')


def _validated_record(payload: FieldVisitPayload) -> dict[str, object]:
    try:
        get_park(payload.park_id)
    except KeyError as error:
        raise HTTPException(status_code=422, detail='Unsupported national park.') from error
    if payload.satellite_feed not in FIRMS_SOURCES:
        raise HTTPException(status_code=422, detail='Field visits require a NASA FIRMS feed.')
    observation = fire_repository.get_record(
        payload.satellite_observation_id,
        feed=payload.satellite_feed,
    )
    if observation is None or observation.get('instrument') not in {'MODIS', 'VIIRS'}:
        raise HTTPException(
            status_code=404,
            detail='The referenced NASA FIRMS satellite observation was not found.',
        )
    latitude = float(observation['latitude'])
    longitude = float(observation['longitude'])
    if not point_in_park(longitude, latitude, payload.park_id):
        raise HTTPException(
            status_code=422,
            detail='The referenced satellite detection is outside the selected park boundary.',
        )
    visit: dict[str, object] = payload.model_dump(mode='json')
    visit.update({
        'satellite_latitude': latitude,
        'satellite_longitude': longitude,
        'satellite_detection_date': observation.get('acquisition_date'),
        'satellite_detection_time_utc': observation.get('acquisition_time'),
        'satellite': observation.get('satellite'),
        'instrument': observation.get('instrument'),
        'satellite_feed': observation.get('feed'),
        'source': observation.get('source'),
        'updated_at_utc': datetime.now(timezone.utc).isoformat(),
    })
    return visit


@router.get('/field-visits', dependencies=[Depends(require_field_access_key)])
def list_field_visits(park_id: str | None = None) -> dict[str, object]:
    if park_id:
        try:
            get_park(park_id)
        except KeyError as error:
            raise HTTPException(status_code=422, detail='Unsupported national park.') from error
    return {'items': field_visit_repository.list_visits(park_id)}


@router.post('/field-visits', dependencies=[Depends(require_field_access_key)])
def create_field_visit(
    payload: FieldVisitPayload,
    response: Response,
) -> dict[str, object]:
    visit, created = field_visit_repository.create_visit(_validated_record(payload))
    response.status_code = 201 if created else 200
    return {'item': visit, 'created': created}


@router.put('/field-visits/{client_id}', dependencies=[Depends(require_field_access_key)])
def update_field_visit(
    client_id: str,
    payload: FieldVisitPayload,
) -> dict[str, object]:
    if client_id != payload.client_id:
        raise HTTPException(status_code=422, detail='Visit ID does not match the request body.')
    visit = field_visit_repository.update_visit(client_id, _validated_record(payload))
    if visit is None:
        raise HTTPException(status_code=404, detail='Field visit was not found.')
    return {'item': visit}
