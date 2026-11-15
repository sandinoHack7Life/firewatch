from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class FireObservation(BaseModel):
    observation_id: str
    latitude: float
    longitude: float
    acquisition_date: str
    acquisition_time: str | None = None
    satellite: str
    instrument: str
    product: str
    brightness_temperature: float | None = None
    brightness_temperature_2: float | None = None
    frp: float | None = None
    confidence: str | float | None = None
    day_night: str | None = None
    processing_type: str
    source: str
    original_source: str | None = None
    version: str | None = None
    feed: str | None = None
    event_id: str | None = None
    event_title: str | None = None
    event_url: str | None = None
    geometry: dict[str, Any] | None = None


class DashboardSummary(BaseModel):
    total_detections: int
    modis_detections: int
    viirs_detections: int
    recent_activity: list[dict[str, float | str]]
    selected_area: str
    selected_period: str
    source_note: str


class FireListResponse(BaseModel):
    items: list[FireObservation]
    total: int
    page: int
    page_size: int
    source: str


class ReportRequest(BaseModel):
    region: str = 'global'
    park_id: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    sensors: list[str] = Field(default_factory=lambda: ['MODIS', 'VIIRS'])
    aggregation: str = 'daily'
    bbox: list[float] | None = None
    search: str | None = None
    min_frp: float | None = Field(default=None, ge=0)


class ReportResponse(BaseModel):
    generated_at: str
    region: str
    sensor_selection: list[str]
    record_count: int
    csv_url: str | None = None
    geojson_url: str | None = None
    summary: dict[str, object]
