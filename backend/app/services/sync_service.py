from __future__ import annotations

import asyncio
import logging
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from app.core.config import Settings
from app.repositories.fire_repository import FireRepository
from app.services.firms.client import FIRMSClient, FIRMS_SOURCES
from app.services.firms.eonet import EONETClient
from app.services.parks.registry import MOZAMBIQUE_FIRMS_BBOX

logger = logging.getLogger(__name__)


class LiveSyncService:
    def __init__(
        self,
        settings: Settings,
        repository: FireRepository,
        alert_service: Any | None = None,
    ) -> None:
        self.settings = settings
        self.repository = repository
        self.firms = FIRMSClient(settings.firms_map_key)
        self.eonet = EONETClient(settings.eonet_api_url)
        self.alert_service = alert_service
        self.last_sync_utc: str | None = None
        self.last_sync_status = 'starting'
        self.source_status: dict[str, dict[str, Any]] = {}
        self._last_sync_monotonic: float | None = None
        self._sync_lock = asyncio.Lock()
        self._has_completed_sync = False

    async def sync_once(self) -> dict[str, Any]:
        async with self._sync_lock:
            new_records: list[dict[str, Any]] = []
            now = datetime.now(timezone.utc)
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(45.0, connect=10.0),
                    headers={'User-Agent': 'MODIS-VIIRS-Firewatch/1.0'},
                ) as client:
                    work: dict[str, Any] = {
                        'NASA_EONET': self.eonet.fetch_events(client),
                    }
                    if self.settings.firms_map_key:
                        for feed in FIRMS_SOURCES:
                            work[feed] = self.firms.fetch_source(
                                feed,
                                day_range=self.settings.firms_day_range,
                                area=MOZAMBIQUE_FIRMS_BBOX,
                                client=client,
                            )
                    else:
                        for feed in FIRMS_SOURCES:
                            self.source_status[feed] = {
                                'status': 'credentials_required',
                                'message': 'Configure FIRMS_MAP_KEY to enable direct thermal-anomaly CSV feeds.',
                                'record_count': 0,
                            }
                    names = list(work)
                    results = await asyncio.gather(
                        *work.values(),
                        return_exceptions=True,
                    )
                for feed, result in zip(names, results, strict=True):
                    if isinstance(result, BaseException):
                        if feed in FIRMS_SOURCES:
                            message = (
                                f'NASA FIRMS request failed ({type(result).__name__}).'
                            )
                        else:
                            message = str(result)
                        self.source_status[feed] = {
                            'status': 'error',
                            'message': message,
                            'record_count': 0,
                        }
                        logger.warning('Live data sync failed for %s: %s', feed, message)
                        continue
                    source_records = result
                    new_records.extend(
                        self.repository.replace_source(feed, source_records)
                    )
                    self.source_status[feed] = {
                        'status': 'online',
                        'message': None,
                        'record_count': len(source_records),
                    }
            except httpx.HTTPError as error:
                logger.exception('Live data sync HTTP failure')
                self.last_sync_status = 'degraded'
                self.source_status.setdefault('sync', {
                    'status': 'error',
                    'message': str(error),
                    'record_count': 0,
                })
            except Exception:
                logger.exception('Unexpected live data sync failure')
                self.last_sync_status = 'degraded'
                self.source_status['sync'] = {
                    'status': 'error',
                    'message': 'Unexpected synchronization error; see backend logs.',
                    'record_count': 0,
                }

            if self.alert_service is not None:
                try:
                    await self.alert_service.evaluate(
                        new_records if self._has_completed_sync else []
                    )
                except Exception:
                    logger.exception('Alert evaluation failed after live data synchronization')

            self.last_sync_utc = now.isoformat()
            self._last_sync_monotonic = time.monotonic()
            self._has_completed_sync = True
            if any(state.get('status') == 'online' for state in self.source_status.values()):
                self.last_sync_status = 'online'
            elif any(state.get('status') == 'error' for state in self.source_status.values()):
                self.last_sync_status = 'degraded'
            else:
                self.last_sync_status = 'waiting_for_credentials'
            return self.telemetry()

    def telemetry(self) -> dict[str, Any]:
        if self._last_sync_monotonic is None:
            next_sync = self.settings.sync_interval_seconds
        else:
            elapsed = time.monotonic() - self._last_sync_monotonic
            next_sync = max(0, self.settings.sync_interval_seconds - int(elapsed))
        return {
            'status': self.last_sync_status,
            'last_sync_utc': self.last_sync_utc,
            'next_sync_in_seconds': next_sync,
            'sync_interval_seconds': self.settings.sync_interval_seconds,
            'active_satellites': self.repository.satellite_names(),
            'sources': self.source_status,
            'observation_count': len(self.repository.list_records(limit=None)),
        }

    async def run_forever(self) -> None:
        while True:
            await asyncio.sleep(max(15, self.settings.sync_interval_seconds))
            await self.sync_once()

    async def start(self) -> asyncio.Task[None]:
        await self.sync_once()
        return asyncio.create_task(self.run_forever(), name='live-fire-data-sync')
