from __future__ import annotations

import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any, Iterator


class FieldVisitRepository:
    """Private, separate SQLite storage for field verification records."""

    def __init__(self, database_path: str | Path) -> None:
        self.database_path = Path(database_path).expanduser()
        self.database_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        if os.name != 'nt':
            self.database_path.parent.chmod(0o700)
        self._lock = RLock()
        with self._connection() as connection:
            connection.execute(
                '''CREATE TABLE IF NOT EXISTS field_visits (
                    client_id TEXT PRIMARY KEY,
                    park_id TEXT NOT NULL,
                    form_created_at_utc TEXT NOT NULL,
                    updated_at_utc TEXT NOT NULL,
                    payload TEXT NOT NULL
                )'''
            )
            connection.execute(
                'CREATE INDEX IF NOT EXISTS ix_field_visits_park_created '
                'ON field_visits (park_id, form_created_at_utc)'
            )
        if os.name != 'nt' and self.database_path.exists():
            self.database_path.chmod(0o600)

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

    def list_visits(self, park_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock, self._connection() as connection:
            if park_id:
                rows = connection.execute(
                    '''SELECT payload FROM field_visits
                       WHERE park_id = ? ORDER BY form_created_at_utc DESC LIMIT 1000''',
                    (park_id,),
                ).fetchall()
            else:
                rows = connection.execute(
                    '''SELECT payload FROM field_visits
                       ORDER BY form_created_at_utc DESC LIMIT 1000'''
                ).fetchall()
        return [json.loads(row['payload']) for row in rows]

    def get_visit(self, client_id: str) -> dict[str, Any] | None:
        with self._lock, self._connection() as connection:
            row = connection.execute(
                'SELECT payload FROM field_visits WHERE client_id = ?',
                (client_id,),
            ).fetchone()
        return json.loads(row['payload']) if row else None

    def create_visit(self, visit: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        client_id = str(visit['client_id'])
        with self._lock, self._connection() as connection:
            existing = connection.execute(
                'SELECT payload FROM field_visits WHERE client_id = ?',
                (client_id,),
            ).fetchone()
            if existing:
                return json.loads(existing['payload']), False
            connection.execute(
                '''INSERT INTO field_visits
                   (client_id, park_id, form_created_at_utc, updated_at_utc, payload)
                   VALUES (?, ?, ?, ?, ?)''',
                (
                    client_id,
                    visit['park_id'],
                    visit['form_created_at_utc'],
                    visit['updated_at_utc'],
                    json.dumps(visit, separators=(',', ':')),
                ),
            )
        return visit, True

    def update_visit(self, client_id: str, visit: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock, self._connection() as connection:
            existing = connection.execute(
                'SELECT form_created_at_utc FROM field_visits WHERE client_id = ?',
                (client_id,),
            ).fetchone()
            if existing is None:
                return None
            visit['client_id'] = client_id
            visit['form_created_at_utc'] = existing['form_created_at_utc']
            connection.execute(
                '''UPDATE field_visits SET park_id = ?, updated_at_utc = ?, payload = ?
                   WHERE client_id = ?''',
                (
                    visit['park_id'],
                    visit['updated_at_utc'],
                    json.dumps(visit, separators=(',', ':')),
                    client_id,
                ),
            )
        return visit
