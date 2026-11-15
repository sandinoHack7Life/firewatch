from __future__ import annotations

import base64
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Response

from app.container import field_visit_repository, fire_repository
from app.schemas.field_visit import FieldVisitDispatchRequest, FieldVisitPayload
from app.services.firms.client import FIRMS_SOURCES
from app.api.v1.endpoints.park_scope import DEFAULT_PARK_ID, require_registered_park
from app.services.parks.registry import point_in_park
from app.services.runtime import alert_service

router = APIRouter()


def _validated_record(payload: FieldVisitPayload) -> dict[str, object]:
    require_registered_park(payload.park_id)
    observation = None
    if payload.record_type == 'detection':
        if payload.satellite_feed not in FIRMS_SOURCES or not payload.satellite_observation_id:
            raise HTTPException(status_code=422, detail='Select a valid NASA FIRMS detection.')
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
    elif payload.satellite_feed is not None or payload.satellite_observation_id is not None:
        raise HTTPException(status_code=422, detail='Manual patrol records cannot reference a satellite detection.')
    elif payload.field_latitude is not None and not point_in_park(
        payload.field_longitude,
        payload.field_latitude,
        payload.park_id,
    ):
        raise HTTPException(
            status_code=422,
            detail='The field coordinates are outside the selected park boundary.',
        )

    visit: dict[str, object] = payload.model_dump(mode='json')
    created_at = payload.form_created_at_utc
    report_reference = payload.report_reference or (
        f'FW-{payload.park_id[:3].upper()}-{created_at.year}-{uuid4().hex[:16].upper()}'
    )
    visit.update({
        'report_reference': report_reference,
        'satellite_latitude': float(observation['latitude']) if observation else None,
        'satellite_longitude': float(observation['longitude']) if observation else None,
        'satellite_detection_date': observation.get('acquisition_date') if observation else None,
        'satellite_detection_time_utc': observation.get('acquisition_time') if observation else None,
        'satellite': observation.get('satellite') if observation else None,
        'instrument': observation.get('instrument') if observation else None,
        'satellite_feed': observation.get('feed') if observation else None,
        'source': observation.get('source') if observation else 'Manual field report',
        'updated_at_utc': datetime.now(timezone.utc).isoformat(),
    })
    return visit


@router.get('/field-visits')
def list_field_visits(
    park_id: str = Query(default=DEFAULT_PARK_ID),
) -> dict[str, object]:
    require_registered_park(park_id)
    return {'items': field_visit_repository.list_visits(park_id)}


@router.post('/field-visits')
def create_field_visit(
    payload: FieldVisitPayload,
    response: Response,
) -> dict[str, object]:
    visit, created = field_visit_repository.create_visit(_validated_record(payload))
    response.status_code = 201 if created else 200
    return {'item': visit, 'created': created}


@router.put('/field-visits/{client_id}')
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


@router.post('/field-visits/{client_id}/dispatch')
async def dispatch_field_visit_report(
    client_id: str,
    payload: FieldVisitDispatchRequest,
) -> dict[str, object]:
    visit = field_visit_repository.get_visit(client_id)
    if visit is None:
        raise HTTPException(status_code=404, detail='Field visit was not found.')

    recipients = ['firewatch.mz.alertas@gmail.com']
    if payload.additional_recipient and payload.additional_recipient not in recipients:
        recipients.append(payload.additional_recipient)
    attachments = [
        (
            attachment.filename,
            base64.b64decode(attachment.content_base64, validate=True),
            attachment.content_type,
        )
        for attachment in payload.attachments
    ]
    report_reference = str(visit.get('report_reference') or client_id)
    try:
        item = await alert_service.send_field_report(
            recipients,
            f'Ficha de Observação de Campo {report_reference}',
            payload.notes,
            attachments,
            client_id,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {'item': item}
