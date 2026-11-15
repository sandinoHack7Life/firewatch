from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

VisitStatus = Literal['planned', 'in_progress', 'completed', 'cancelled']
ObservedResult = Literal[
    'active_fire_signs',
    'burn_scars',
    'no_signs_observed',
    'inconclusive',
    'unable_to_verify',
]


class FieldVisitPayload(BaseModel):
    model_config = ConfigDict(extra='forbid')

    client_id: str = Field(min_length=8, max_length=80)
    park_id: str = Field(min_length=1, max_length=40)
    satellite_observation_id: str = Field(min_length=1, max_length=100)
    satellite_feed: str = Field(min_length=1, max_length=40)
    form_created_at_utc: datetime
    scheduled_at_utc: datetime | None = None
    actual_visit_at_utc: datetime | None = None
    status: VisitStatus = 'planned'
    observed_result: ObservedResult | None = None
    field_latitude: float | None = Field(default=None, ge=-90, le=90)
    field_longitude: float | None = Field(default=None, ge=-180, le=180)
    notes: str = Field(default='', max_length=2000)

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
        return self
