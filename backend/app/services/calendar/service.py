from __future__ import annotations

from collections import defaultdict
from datetime import datetime


def aggregate_calendar(records: list[dict[str, object]], view: str = 'daily') -> list[dict[str, object]]:
    by_bucket: dict[str, dict[str, int]] = defaultdict(lambda: {'total': 0, 'modis': 0, 'viirs': 0})
    for record in records:
        date_value = str(record.get('acquisition_date'))
        try:
            dt = datetime.fromisoformat(date_value)
        except ValueError:
            continue
        if view == 'weekly':
            iso_date = dt.isocalendar()
            bucket = f"W{iso_date.week:02d}-{iso_date.year}"
        elif view == 'monthly':
            bucket = f"{dt.year}-{dt.month:02d}"
        elif view == 'yearly':
            bucket = str(dt.year)
        else:
            bucket = date_value
        entry = by_bucket[bucket]
        entry['total'] += 1
        if str(record.get('instrument')) == 'MODIS':
            entry['modis'] += 1
        if str(record.get('instrument')) == 'VIIRS':
            entry['viirs'] += 1
    return [
        {'bucket': bucket, 'total': values['total'], 'modis': values['modis'], 'viirs': values['viirs']}
        for bucket, values in sorted(by_bucket.items())
    ]
