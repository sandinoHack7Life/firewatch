from __future__ import annotations

import base64
import binascii
import re
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VisitStatus = Literal['planned', 'in_progress', 'completed', 'inconclusive', 'cancelled']
ObservedResult = Literal[
    'active_fire_signs',
    'burn_scars',
    'controlled_burn',
    'false_positive',
    'no_signs_observed',
    'inconclusive',
    'unable_to_verify',
    'access_impossible',
]
FieldVisitRecordType = Literal['detection', 'manual']
FireSeverity = Literal['low', 'moderate', 'high', 'critical']
VegetationType = Literal['dense_forest', 'savanna_grass', 'agricultural', 'open_forest']
WeatherCondition = Literal['strong_wind', 'dry_weather', 'recent_rain']
RecordClassification = Literal['operational', 'simulation']


class FieldVisitPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')

    client_id: str = Field(min_length=8, max_length=80, pattern=r'^[A-Za-z0-9_-]+$')
    report_reference: str | None = Field(
        default=None,
        min_length=1,
        max_length=48,
        pattern=r'^[A-Za-z0-9-]+$',
    )
    park_id: str = Field(min_length=1, max_length=40)
    record_type: FieldVisitRecordType = 'detection'
    satellite_observation_id: str | None = Field(default=None, min_length=1, max_length=100)
    satellite_feed: str | None = Field(default=None, min_length=1, max_length=40)
    form_created_at_utc: datetime
    scheduled_at_utc: datetime | None = None
    actual_visit_at_utc: datetime | None = None
    status: VisitStatus = 'planned'
    observed_result: ObservedResult | None = None
    field_latitude: float | None = Field(default=None, ge=-90, le=90)
    field_longitude: float | None = Field(default=None, ge=-180, le=180)
    lead_ranger: str = Field(default='', max_length=120)
    unit_sector: str = Field(default='', max_length=160)
    severity: FireSeverity | None = None
    estimated_area_ha: float | None = Field(default=None, ge=0, le=10_000_000)
    vegetation_type: VegetationType | None = None
    weather_conditions: list[WeatherCondition] = Field(default_factory=list, max_length=3)
    notes: str = Field(default='', max_length=2000)
    evidence_notes: str = Field(default='', max_length=1500)
    evidence_image_data_url: str | None = Field(default=None, max_length=2_800_000)
    classification: RecordClassification = 'operational'

    @field_validator(
        'form_created_at_utc',
        'scheduled_at_utc',
        'actual_visit_at_utc',
    )
    @classmethod
    def normalize_utc_timestamps(cls, value: datetime | None) -> datetime | None:
        if value is not None and value.utcoffset() is None:
            raise ValueError('Timestamps must include a UTC offset.')
        return value.astimezone(timezone.utc) if value is not None else None

    @model_validator(mode='after')
    def validate_coordinates(self) -> FieldVisitPayload:
        if (self.field_latitude is None) != (self.field_longitude is None):
            raise ValueError('Field GPS latitude and longitude must be provided together.')
        if self.record_type == 'detection' and (
            self.satellite_observation_id is None or self.satellite_feed is None
        ):
            raise ValueError('A NASA FIRMS detection and feed are required for linked records.')
        if self.record_type == 'manual' and (
            self.satellite_observation_id is not None or self.satellite_feed is not None
        ):
            raise ValueError('Manual patrol records cannot reference a satellite detection.')
        if self.evidence_image_data_url is not None and not re.fullmatch(
            r'data:image/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}',
            self.evidence_image_data_url,
        ):
            raise ValueError('Evidence must be a PNG or JPEG data URL.')
        return self


class FieldReportAttachment(BaseModel):
    filename: str = Field(min_length=1, max_length=120)
    content_type: Literal[
        'application/pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ]
    content_base64: str = Field(min_length=1, max_length=5_600_000)

    @field_validator('filename')
    @classmethod
    def validate_filename(cls, value: str) -> str:
        if '/' in value or '\\' in value or '\r' in value or '\n' in value:
            raise ValueError('Attachment filename is invalid.')
        return value

    @field_validator('content_base64')
    @classmethod
    def validate_attachment_size(cls, value: str) -> str:
        try:
            decoded = base64.b64decode(value, validate=True)
        except (binascii.Error, ValueError) as error:
            raise ValueError('Attachment content must be valid base64.') from error
        if len(decoded) > 4_000_000:
            raise ValueError('Each report attachment must be 4 MB or smaller.')
        return value


class FieldVisitDispatchRequest(BaseModel):
    additional_recipient: str | None = Field(default=None, max_length=254)
    notes: str = Field(default='', max_length=3000)
    attachments: list[FieldReportAttachment] = Field(min_length=2, max_length=2)

    @field_validator('additional_recipient')
    @classmethod
    def validate_additional_recipient(cls, value: str | None) -> str | None:
        if value is not None and not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value):
            raise ValueError('Additional recipient must be a valid email address.')
        return value

    @model_validator(mode='after')
    def validate_attachments(self) -> FieldVisitDispatchRequest:
        types = {attachment.content_type for attachment in self.attachments}
        required_types = {
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }
        if types != required_types:
            raise ValueError('Attach one PDF and one DOCX field verification report.')
        if sum(len(attachment.content_base64) for attachment in self.attachments) > 10_700_000:
            raise ValueError('Combined report attachments must be 8 MB or smaller.')
        return self
