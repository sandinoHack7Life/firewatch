from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from threading import RLock
from typing import Any, Iterator


class FireRepository:
    """Durable SQLite store for source-attributed live observations."""

    def __init__(self, database_path: str | Path, retention_days: int = 730) -> None:
        if retention_days < 1:
            raise ValueError('Observation retention must be at least one day.')
        self.database_path = Path(database_path).expanduser()
        self.retention_days = retention_days
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = RLock()
        with self._connection() as connection:
            connection.execute(
                '''CREATE TABLE IF NOT EXISTS observations (
                    observation_key TEXT PRIMARY KEY,
                    feed TEXT NOT NULL,
                    observation_id TEXT NOT NULL,
                    acquisition_date TEXT NOT NULL,
                    acquisition_time TEXT,
                    instrument TEXT NOT NULL,
                    latitude REAL NOT NULL,
                    longitude REAL NOT NULL,
                    frp REAL,
                    source TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    last_seen_utc TEXT NOT NULL
                )'''
            )
            connection.execute(
                'CREATE INDEX IF NOT EXISTS ix_observations_date ON observations (acquisition_date)'
            )
            connection.execute(
                'CREATE INDEX IF NOT EXISTS ix_observations_sensor ON observations (instrument)'
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path, timeout=15)
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

    def replace_source(
        self,
        feed: str,
        records: list[dict[str, Any]],
    ) -> list[dict[str, Any]]:
        with self._lock:
            incoming: dict[str, dict[str, Any]] = {}
            for record in records:
                item = dict(record)
                item['feed'] = feed
                identity = str(item.get('observation_id') or '')
                if identity:
                    incoming[f'{feed}:{identity}'] = item
            with self._connection() as connection:
                previous = {
                    row['observation_key']
                    for row in connection.execute(
                        'SELECT observation_key FROM observations WHERE feed = ?',
                        (feed,),
                    ).fetchall()
                }
                now = datetime.now(timezone.utc).isoformat()
                for key, item in incoming.items():
                    connection.execute(
                        '''INSERT INTO observations
                           (observation_key, feed, observation_id, acquisition_date,
                            acquisition_time, instrument, latitude, longitude, frp,
                            source, payload, last_seen_utc)
                           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                           ON CONFLICT(observation_key) DO UPDATE SET
                           acquisition_date = excluded.acquisition_date,
                           acquisition_time = excluded.acquisition_time,
                           instrument = excluded.instrument,
                           latitude = excluded.latitude,
                           longitude = excluded.longitude,
                           frp = excluded.frp,
                           source = excluded.source,
                           payload = excluded.payload,
                           last_seen_utc = excluded.last_seen_utc''',
                        (
                            key,
                            feed,
                            str(item.get('observation_id') or ''),
                            str(item.get('acquisition_date') or ''),
                            item.get('acquisition_time'),
                            str(item.get('instrument') or 'Unknown'),
                            float(item['latitude']),
                            float(item['longitude']),
                            float(item['frp']) if item.get('frp') is not None else None,
                            str(item.get('source') or feed),
                            json.dumps(item, separators=(',', ':')),
                            now,
                        ),
                    )
                if feed == 'NASA_EONET':
                    incoming_keys = list(incoming)
                    if incoming_keys:
                        placeholders = ','.join('?' for _ in incoming_keys)
                        connection.execute(
                            f'DELETE FROM observations WHERE feed = ? AND observation_key NOT IN ({placeholders})',
                            [feed, *incoming_keys],
                        )
                    else:
                        connection.execute('DELETE FROM observations WHERE feed = ?', (feed,))
                connection.execute(
                    '''DELETE FROM observations
                       WHERE feed != 'NASA_EONET'
                       AND acquisition_date < date('now', ?)''',
                    (f'-{self.retention_days} day',),
                )
            return [item for key, item in incoming.items() if key not in previous]

    def list_records(
        self,
        *,
        sensors: list[str] | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
        bbox: tuple[float, float, float, float] | None = None,
        min_frp: float | None = None,
        search: str | None = None,
        limit: int | None = 200,
    ) -> list[dict[str, Any]]:
        with self._lock, self._connection() as connection:
            rows = connection.execute('SELECT payload FROM observations').fetchall()
            records = [json.loads(row['payload']) for row in rows]
        if sensors:
            selected = {sensor.upper() for sensor in sensors}
            records = [
                record for record in records
                if str(record.get('instrument', '')).upper() in selected
            ]
        if start_date:
            records = [
                record for record in records
                if str(record.get('acquisition_date', '')) >= start_date
            ]
        if end_date:
            records = [
                record for record in records
                if str(record.get('acquisition_date', '')) <= end_date
            ]
        if bbox:
            min_lon, min_lat, max_lon, max_lat = bbox
            records = [
                record for record in records
                if min_lon <= float(record.get('longitude', 0)) <= max_lon
                and min_lat <= float(record.get('latitude', 0)) <= max_lat
            ]
        if min_frp is not None:
            records = [
                record for record in records
                if record.get('frp') is not None
                and float(record['frp']) >= min_frp
            ]
        if search:
            needle = search.casefold()
            records = [
                record for record in records
                if needle in ' '.join(
                    str(value) for value in (
                        record.get('observation_id'),
                        record.get('product'),
                        record.get('satellite'),
                        record.get('event_title'),
                        record.get('source'),
                    )
                ).casefold()
            ]
        records.sort(
            key=lambda record: (
                str(record.get('acquisition_date') or ''),
                str(record.get('acquisition_time') or ''),
            ),
            reverse=True,
        )
        return records if limit is None else records[:limit]

    def get_record(self, observation_id: str, feed: str | None = None) -> dict[str, Any] | None:
        with self._lock, self._connection() as connection:
            if feed:
                row = connection.execute(
                    '''SELECT payload FROM observations WHERE observation_id = ? AND feed = ?
                       ORDER BY last_seen_utc DESC LIMIT 1''',
                    (observation_id, feed),
                ).fetchone()
            else:
                row = connection.execute(
                    '''SELECT payload FROM observations WHERE observation_id = ?
                       ORDER BY last_seen_utc DESC LIMIT 1''',
                    (observation_id,),
                ).fetchone()
        return json.loads(row['payload']) if row else None

    def get_summary(
        self,
        records: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        if records is None:
            records = self.list_records(limit=None)
        modis = sum(1 for record in records if record.get('instrument') == 'MODIS')
        viirs = sum(1 for record in records if record.get('instrument') == 'VIIRS')
        source_counts: dict[str, int] = {}
        for record in records:
            source = str(record.get('source') or 'Unknown')
            source_counts[source] = source_counts.get(source, 0) + 1
        return {
            'total_detections': len(records),
            'modis_detections': modis,
            'viirs_detections': viirs,
            'eonet_events': len({
                str(record.get('event_id') or record.get('observation_id'))
                for record in records
                if record.get('feed') == 'NASA_EONET'
            }),
            'selected_area': 'global',
            'selected_period': 'live feed',
            'source_counts': source_counts,
            'source_note': 'Live source records only; no synthetic observations are used.',
        }

    def satellite_names(self) -> list[str]:
        names = {
            str(record.get('satellite'))
            for record in self.list_records(limit=None)
            if record.get('satellite')
            and record.get('satellite') != 'Not satellite-derived'
            and record.get('satellite') != 'Unknown'
        }
        return sorted(names)

    def newest_observation_time(self) -> datetime | None:
        records = self.list_records(limit=None)
        values: list[datetime] = []
        for record in records:
            day = record.get('acquisition_date')
            time = str(record.get('acquisition_time') or '0000')
            if not day:
                continue
            try:
                dt = datetime.strptime(f'{day} {time[:4]}', '%Y-%m-%d %H%M')
            except ValueError:
                try:
                    dt = datetime.fromisoformat(str(day).replace('Z', '+00:00'))
                except ValueError:
                    continue
            values.append(dt)
        return max(values) if values else None
