from __future__ import annotations

from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


class SatelliteObservation(Base):
    __tablename__ = 'satellite_observations'

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    observation_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    latitude: Mapped[float] = mapped_column(Float, nullable=False)
    longitude: Mapped[float] = mapped_column(Float, nullable=False)
    acquisition_date: Mapped[str] = mapped_column(String(32), nullable=False)
    acquisition_time: Mapped[str | None] = mapped_column(String(32), nullable=True)
    satellite: Mapped[str] = mapped_column(String(64), nullable=False)
    instrument: Mapped[str] = mapped_column(String(64), nullable=False)
    product: Mapped[str] = mapped_column(String(128), nullable=False)
    brightness_temperature: Mapped[float | None] = mapped_column(Float, nullable=True)
    brightness_temperature_2: Mapped[float | None] = mapped_column(Float, nullable=True)
    frp: Mapped[float | None] = mapped_column(Float, nullable=True)
    confidence: Mapped[str | None] = mapped_column(String(32), nullable=True)
    day_night: Mapped[str | None] = mapped_column(String(8), nullable=True)
    processing_type: Mapped[str] = mapped_column(String(64), nullable=False)
    source: Mapped[str] = mapped_column(String(128), nullable=False)
    original_source: Mapped[str | None] = mapped_column(String(128), nullable=True)
    version: Mapped[str | None] = mapped_column(String(32), nullable=True)
