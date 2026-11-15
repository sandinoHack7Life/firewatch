from __future__ import annotations

import asyncio
import html
import json
import logging
import math
import smtplib
import sqlite3
import ssl
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Iterator

from app.core.config import Settings
from app.repositories.fire_repository import FireRepository
from app.schemas.alerts import WatchlistPayload
from app.services.harmonization.engine import build_potential_matches
from app.services.parks.registry import MOZAMBIQUE_FIRMS_BBOX, point_in_park

logger = logging.getLogger(__name__)

PRESET_BBOXES: dict[str, tuple[float, float, float, float]] = {
    'mozambique': MOZAMBIQUE_FIRMS_BBOX,
    'amazon': (-74.0, -16.0, -44.0, 5.0),
    'california': (-124.5, 32.5, -114.1, 42.0),
}
CONFIDENCE_RANK = {'low': 1, 'nominal': 2, 'high': 3}


class AlertService:
    def __init__(self, settings: Settings, repository: FireRepository) -> None:
        self.settings = settings
        self.repository = repository
        self.database_path = Path(settings.alerts_database_path).expanduser()
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize_database()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=10)
        connection.row_factory = sqlite3.Row
        return connection

    @contextmanager
    def _connection(self) -> Iterator[sqlite3.Connection]:
        connection = self._connect()
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def _initialize_database(self) -> None:
        with self._connect() as connection:
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute(
                '''CREATE TABLE IF NOT EXISTS watchlists (
                    id TEXT PRIMARY KEY,
                    payload TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )'''
            )
            connection.execute(
                '''CREATE TABLE IF NOT EXISTS dispatch_history (
                    id TEXT PRIMARY KEY,
                    watchlist_id TEXT NOT NULL,
                    triggered_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    message TEXT NOT NULL,
                    recipients TEXT NOT NULL,
                    observations TEXT NOT NULL
                )'''
            )
            connection.execute(
                '''CREATE TABLE IF NOT EXISTS pending_digests (
                    watchlist_id TEXT PRIMARY KEY,
                    due_at TEXT NOT NULL,
                    observations TEXT NOT NULL
                )'''
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).isoformat()

    def list_watchlists(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                'SELECT id, payload, created_at, updated_at FROM watchlists ORDER BY created_at DESC'
            ).fetchall()
        return [
            {
                **json.loads(row['payload']),
                'id': row['id'],
                'created_at': row['created_at'],
                'updated_at': row['updated_at'],
            }
            for row in rows
        ]

    def get_watchlist(self, watchlist_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                'SELECT id, payload, created_at, updated_at FROM watchlists WHERE id = ?',
                (watchlist_id,),
            ).fetchone()
        if row is None:
            return None
        return {
            **json.loads(row['payload']),
            'id': row['id'],
            'created_at': row['created_at'],
            'updated_at': row['updated_at'],
        }

    def create_watchlist(self, payload: WatchlistPayload) -> dict[str, Any]:
        watchlist_id = str(uuid.uuid4())
        now = self._now()
        data = payload.model_dump(mode='json')
        with self._connect() as connection:
            connection.execute(
                'INSERT INTO watchlists (id, payload, created_at, updated_at) VALUES (?, ?, ?, ?)',
                (watchlist_id, json.dumps(data), now, now),
            )
        return {**data, 'id': watchlist_id, 'created_at': now, 'updated_at': now}

    def update_watchlist(
        self,
        watchlist_id: str,
        payload: WatchlistPayload,
    ) -> dict[str, Any] | None:
        now = self._now()
        data = payload.model_dump(mode='json')
        with self._connect() as connection:
            cursor = connection.execute(
                'UPDATE watchlists SET payload = ?, updated_at = ? WHERE id = ?',
                (json.dumps(data), now, watchlist_id),
            )
        if cursor.rowcount == 0:
            return None
        existing = self.get_watchlist(watchlist_id)
        if existing is None:
            return None
        return existing

    def delete_watchlist(self, watchlist_id: str) -> bool:
        with self._connect() as connection:
            cursor = connection.execute('DELETE FROM watchlists WHERE id = ?', (watchlist_id,))
            connection.execute('DELETE FROM pending_digests WHERE watchlist_id = ?', (watchlist_id,))
        return cursor.rowcount > 0

    def list_history(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                '''SELECT id, watchlist_id, triggered_at, status, message, recipients, observations
                   FROM dispatch_history ORDER BY triggered_at DESC LIMIT ?''',
                (limit,),
            ).fetchall()
        return [
            {
                'id': row['id'],
                'watchlist_id': row['watchlist_id'],
                'triggered_at': row['triggered_at'],
                'status': row['status'],
                'message': row['message'],
                'recipients': json.loads(row['recipients']),
                'matched_observations': json.loads(row['observations']),
            }
            for row in rows
        ]

    @property
    def smtp_configured(self) -> bool:
        return bool(
            self.settings.smtp_host
            and (self.settings.smtp_from_email or self.settings.smtp_user)
        )

    def _deliver(
        self,
        recipients: list[str],
        subject: str,
        notes: str,
        observations: list[dict[str, Any]],
    ) -> tuple[str, str]:
        if not self.smtp_configured:
            return 'not_configured', 'SMTP_HOST and SMTP_FROM_EMAIL are required for delivery.'
        message = EmailMessage()
        message['Subject'] = subject
        message['From'] = self.settings.smtp_from_email or self.settings.smtp_user
        message['To'] = ', '.join(recipients)
        rows = ''.join(
            '<tr>'
            f'<td>{html.escape(str(item.get("acquisition_date") or ""))} '
            f'{html.escape(str(item.get("acquisition_time") or ""))} UTC</td>'
            f'<td>{html.escape(str(item.get("satellite") or "Unknown"))}</td>'
            f'<td>{html.escape(str(item.get("latitude")))}, {html.escape(str(item.get("longitude")))}</td>'
            f'<td>{html.escape(str(item.get("frp") if item.get("frp") is not None else "not reported"))} MW</td>'
            f'<td>{html.escape(str(item.get("confidence") if item.get("confidence") is not None else "not reported"))}</td>'
            f'<td>{html.escape(str(item.get("observation_id") or ""))}</td>'
            '</tr>'
            for item in observations
        )
        map_link = 'https://firms.modaps.eosdis.nasa.gov/map/'
        html_body = (
            '<html><body><h2>Satellite fire observation alert</h2>'
            f'<p>{html.escape(notes)}</p>'
            '<p>NASA FIRMS satellite thermal anomaly records matching the configured watchlist:</p>'
            '<table border="1" cellpadding="6" cellspacing="0"><thead><tr>'
            '<th>Acquisition (UTC)</th><th>Satellite</th><th>Latitude, longitude</th>'
            '<th>FRP</th><th>Confidence</th><th>Observation ID</th></tr></thead>'
            f'<tbody>{rows}</tbody></table>'
            f'<p><a href="{map_link}">Open NASA FIRMS map</a></p>'
            '<p>These are satellite observations and are not, by themselves, confirmation of a ground fire.</p>'
            '</body></html>'
        )
        message.set_content(
            f'Firewatch alert: {len(observations)} satellite observation(s) matched the watchlist. '
            f'Open NASA FIRMS: {map_link}'
        )
        message.add_alternative(html_body, subtype='html')
        try:
            if self.settings.smtp_port == 465:
                with smtplib.SMTP_SSL(
                    self.settings.smtp_host,
                    self.settings.smtp_port,
                    timeout=20,
                    context=ssl.create_default_context(),
                ) as server:
                    if self.settings.smtp_user:
                        server.login(self.settings.smtp_user, self.settings.smtp_password)
                    server.send_message(message)
            else:
                with smtplib.SMTP(
                    self.settings.smtp_host,
                    self.settings.smtp_port,
                    timeout=20,
                ) as server:
                    server.ehlo()
                    if self.settings.smtp_use_starttls:
                        server.starttls(context=ssl.create_default_context())
                        server.ehlo()
                    if self.settings.smtp_user:
                        server.login(self.settings.smtp_user, self.settings.smtp_password)
                    server.send_message(message)
            return 'sent', 'Email accepted by the configured SMTP server.'
        except (OSError, smtplib.SMTPException) as error:
            logger.exception('SMTP alert delivery failed')
            return 'failed', str(error)

    def _write_history(
        self,
        watchlist_id: str,
        status: str,
        message: str,
        recipients: list[str],
        observations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        entry = {
            'id': str(uuid.uuid4()),
            'watchlist_id': watchlist_id,
            'triggered_at': self._now(),
            'status': status,
            'message': message,
            'recipients': recipients,
            'matched_observations': [
                {
                    key: record.get(key)
                    for key in (
                        'observation_id',
                        'latitude',
                        'longitude',
                        'acquisition_date',
                        'acquisition_time',
                        'satellite',
                        'instrument',
                        'frp',
                        'confidence',
                        'source',
                    )
                }
                for record in observations
            ],
        }
        with self._connect() as connection:
            connection.execute(
                '''INSERT INTO dispatch_history
                   (id, watchlist_id, triggered_at, status, message, recipients, observations)
                   VALUES (?, ?, ?, ?, ?, ?, ?)''',
                (
                    entry['id'],
                    watchlist_id,
                    entry['triggered_at'],
                    status,
                    message,
                    json.dumps(recipients),
                    json.dumps(entry['matched_observations']),
                ),
            )
        return entry

    async def send_test(self, recipient: str, subject: str, notes: str) -> dict[str, Any]:
        status, message = await asyncio.to_thread(
            self._deliver,
            [recipient],
            subject,
            notes,
            [],
        )
        entry = self._write_history(
            'smtp-test',
            status,
            message,
            [recipient],
            [],
        )
        if status != 'sent':
            raise RuntimeError(message)
        return entry

    @staticmethod
    def _confidence_meets(value: Any, minimum: str) -> bool:
        if value is None:
            return False
        text = str(value).strip().lower()
        if text in CONFIDENCE_RANK:
            return CONFIDENCE_RANK[text] >= CONFIDENCE_RANK[minimum]
        try:
            numeric = float(text)
        except ValueError:
            return False
        return numeric >= {'low': 0, 'nominal': 50, 'high': 80}[minimum]

    @staticmethod
    def _inside_geofence(record: dict[str, Any], watchlist: dict[str, Any]) -> bool:
        latitude = float(record['latitude'])
        longitude = float(record['longitude'])
        kind = watchlist['geofence_type']
        if kind == 'park':
            return point_in_park(
                longitude,
                latitude,
                str(watchlist['park_id']),
            )
        if kind == 'preset':
            west, south, east, north = PRESET_BBOXES[str(watchlist['preset'])]
            return west <= longitude <= east and south <= latitude <= north
        if kind == 'bbox':
            west, south, east, north = watchlist['bbox']
            return west <= longitude <= east and south <= latitude <= north
        radius = float(watchlist['radius_km'])
        center_lat = float(watchlist['latitude'])
        center_lon = float(watchlist['longitude'])
        earth_radius_km = 6371.0088
        d_lat = math.radians(latitude - center_lat)
        d_lon = math.radians(longitude - center_lon)
        haversine = (
            math.sin(d_lat / 2) ** 2
            + math.cos(math.radians(center_lat))
            * math.cos(math.radians(latitude))
            * math.sin(d_lon / 2) ** 2
        )
        distance = 2 * earth_radius_km * math.asin(min(1, math.sqrt(haversine)))
        return distance <= radius

    def _matches_sensor(
        self,
        record: dict[str, Any],
        sensor_filter: str,
        harmonized_ids: set[str],
    ) -> bool:
        instrument = str(record.get('instrument', '')).upper()
        if sensor_filter in {'MODIS', 'VIIRS'}:
            return instrument == sensor_filter
        return (
            instrument in {'MODIS', 'VIIRS'}
            and str(record.get('observation_id')) in harmonized_ids
            and self._confidence_meets(record.get('confidence'), 'high')
        )

    @staticmethod
    def _next_digest_time(frequency: str) -> str:
        now = datetime.now(timezone.utc)
        if frequency == 'hourly':
            due = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        else:
            due = (now + timedelta(days=1)).replace(
                hour=0,
                minute=0,
                second=0,
                microsecond=0,
            )
        return due.isoformat()

    def _queue_digest(
        self,
        watchlist: dict[str, Any],
        observations: list[dict[str, Any]],
    ) -> None:
        watchlist_id = str(watchlist['id'])
        with self._connect() as connection:
            row = connection.execute(
                'SELECT due_at, observations FROM pending_digests WHERE watchlist_id = ?',
                (watchlist_id,),
            ).fetchone()
            existing = json.loads(row['observations']) if row else []
            seen = {str(item.get('observation_id')) for item in existing}
            new_items = [
                item for item in observations
                if str(item.get('observation_id')) not in seen
            ]
            combined = existing + new_items
            due_at = row['due_at'] if row else self._next_digest_time(
                str(watchlist['notification_frequency'])
            )
            connection.execute(
                '''INSERT INTO pending_digests (watchlist_id, due_at, observations)
                   VALUES (?, ?, ?)
                   ON CONFLICT(watchlist_id) DO UPDATE SET
                   due_at = excluded.due_at, observations = excluded.observations''',
                (watchlist_id, due_at, json.dumps(combined)),
            )
        if new_items:
            self._write_history(
                watchlist_id,
                'queued',
                f'{len(new_items)} matching observation(s) queued for {watchlist["notification_frequency"]} digest.',
                list(watchlist['recipients']),
                new_items,
            )

    async def _dispatch(
        self,
        watchlist: dict[str, Any],
        observations: list[dict[str, Any]],
    ) -> dict[str, Any]:
        status, message = await asyncio.to_thread(
            self._deliver,
            list(watchlist['recipients']),
            str(watchlist['subject']),
            str(watchlist['notes']),
            observations,
        )
        return self._write_history(
            str(watchlist['id']),
            status,
            message,
            list(watchlist['recipients']),
            observations,
        )

    async def evaluate(self, new_records: list[dict[str, Any]]) -> None:
        watchlists = [item for item in self.list_watchlists() if item.get('enabled')]
        needs_harmonized = any(
            item['sensor_filter'] == 'HARMONIZED_HIGH_CONFIDENCE'
            for item in watchlists
        )
        harmonized_ids: set[str] = set()
        if needs_harmonized:
            for record in new_records:
                instrument = record.get('instrument')
                if instrument not in {'MODIS', 'VIIRS'}:
                    continue
                day = str(record.get('acquisition_date') or '')
                if not day:
                    continue
                latitude = float(record['latitude'])
                longitude = float(record['longitude'])
                delta_lon = min(0.05, 0.05 / max(0.2, math.cos(math.radians(latitude))))
                other_sensor = 'VIIRS' if instrument == 'MODIS' else 'MODIS'
                nearby = self.repository.list_records(
                    sensors=[other_sensor],
                    start_date=(datetime.fromisoformat(day) - timedelta(days=1)).date().isoformat(),
                    end_date=(datetime.fromisoformat(day) + timedelta(days=1)).date().isoformat(),
                    bbox=(
                        max(-180, longitude - delta_lon),
                        max(-90, latitude - 0.05),
                        min(180, longitude + delta_lon),
                        min(90, latitude + 0.05),
                    ),
                    limit=None,
                )
                for match in build_potential_matches([record, *nearby]):
                    harmonized_ids.add(str(match['left_observation_id']))
                    harmonized_ids.add(str(match['right_observation_id']))
        for watchlist in watchlists:
            candidates: list[dict[str, Any]] = []
            for record in new_records:
                if record.get('feed') == 'NASA_EONET':
                    continue
                if record.get('instrument') not in {'MODIS', 'VIIRS'}:
                    continue
                if record.get('frp') is None or float(record['frp']) < float(watchlist['min_frp_mw']):
                    continue
                if not self._confidence_meets(record.get('confidence'), str(watchlist['min_confidence'])):
                    continue
                if not self._matches_sensor(record, str(watchlist['sensor_filter']), harmonized_ids):
                    continue
                if self._inside_geofence(record, watchlist):
                    candidates.append(record)
            if not candidates:
                continue
            if watchlist['notification_frequency'] == 'immediate':
                await self._dispatch(watchlist, candidates)
            else:
                self._queue_digest(watchlist, candidates)
        await self.flush_due_digests()

    async def flush_due_digests(self) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            rows = connection.execute(
                'SELECT watchlist_id, observations FROM pending_digests WHERE due_at <= ?',
                (now,),
            ).fetchall()
        for row in rows:
            watchlist_id = row['watchlist_id']
            watchlist = self.get_watchlist(watchlist_id)
            if watchlist is None or not watchlist.get('enabled'):
                with self._connect() as connection:
                    connection.execute(
                        'DELETE FROM pending_digests WHERE watchlist_id = ?',
                        (watchlist_id,),
                    )
                continue
            observations = json.loads(row['observations'])
            if observations:
                await self._dispatch(watchlist, observations)
            with self._connect() as connection:
                connection.execute(
                    'DELETE FROM pending_digests WHERE watchlist_id = ?',
                    (watchlist_id,),
                )
