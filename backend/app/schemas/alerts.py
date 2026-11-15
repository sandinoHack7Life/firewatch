from __future__ import annotations

import re
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator


GeofenceType = Literal['preset', 'radius', 'bbox', 'park']
AlertSensor = Literal['MODIS', 'VIIRS', 'HARMONIZED_HIGH_CONFIDENCE']
AlertFrequency = Literal['immediate', 'hourly', 'daily']
AlertConfidence = Literal['low', 'nominal', 'high']


class WatchlistPayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    enabled: bool = True
    geofence_type: GeofenceType
    preset: Literal['mozambique', 'amazon', 'california'] | None = None
    park_id: str | None = Field(default=None, min_length=1, max_length=40)
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    radius_km: float | None = Field(default=None, gt=0, le=2000)
    bbox: list[float] | None = None
    sensor_filter: AlertSensor = 'VIIRS'
    min_frp_mw: float = Field(default=0, ge=0)
    min_confidence: AlertConfidence = 'nominal'
    notification_frequency: AlertFrequency = 'immediate'
    recipients: list[str] = Field(min_length=1, max_length=20)
    subject: str = Field(default='Firewatch satellite fire alert', max_length=180)
    notes: str = Field(default='', max_length=2000)

    @field_validator('subject')
    @classmethod
    def validate_subject(cls, value: str) -> str:
        if '\r' in value or '\n' in value:
            raise ValueError('Subject must not contain line breaks.')
        return value

    @model_validator(mode='after')
    def validate_geofence_and_recipients(self) -> WatchlistPayload:
        if self.geofence_type == 'preset' and self.preset is None:
            raise ValueError('A named preset is required for a preset geofence.')
        if self.geofence_type == 'park' and self.park_id is None:
            raise ValueError('A national park is required for a park geofence.')
        if self.geofence_type == 'radius':
            if self.latitude is None or self.longitude is None or self.radius_km is None:
                raise ValueError('Radius geofences require latitude, longitude, and radius_km.')
        if self.geofence_type == 'bbox':
            if self.bbox is None or len(self.bbox) != 4:
                raise ValueError('Bounding-box geofences require [west, south, east, north].')
            west, south, east, north = self.bbox
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError('Bounding-box coordinates are invalid.')
        if any(not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', value) for value in self.recipients):
            raise ValueError('Every recipient must be a valid email address.')
        return self


class WatchlistCreate(WatchlistPayload):
    pass


class WatchlistUpdate(WatchlistPayload):
    pass


class TestAlertRequest(BaseModel):
    recipient: str
    subject: str = Field(default='Firewatch test alert', max_length=180)
    notes: str = Field(default='SMTP configuration test.', max_length=2000)

    @field_validator('subject')
    @classmethod
    def validate_subject(cls, value: str) -> str:
        if '\r' in value or '\n' in value:
            raise ValueError('Subject must not contain line breaks.')
        return value

    @model_validator(mode='after')
    def validate_recipient(self) -> TestAlertRequest:
        if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', self.recipient):
            raise ValueError('Recipient must be a valid email address.')
        return self
