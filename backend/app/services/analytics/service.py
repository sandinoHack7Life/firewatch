from __future__ import annotations

from collections import defaultdict
from datetime import datetime


def aggregate_daily(records: list[dict[str, object]]) -> list[dict[str, object]]:
    totals: dict[str, int] = defaultdict(int)
    modis_totals: dict[str, int] = defaultdict(int)
    viirs_totals: dict[str, int] = defaultdict(int)
    frp_totals: dict[str, float] = defaultdict(float)
    for record in records:
        if record.get('instrument') not in {'MODIS', 'VIIRS'}:
            continue
        day = str(record.get('acquisition_date'))
        totals[day] += 1
        if str(record.get('instrument')) == 'MODIS':
            modis_totals[day] += 1
        if str(record.get('instrument')) == 'VIIRS':
            viirs_totals[day] += 1
        if record.get('frp') is not None:
            frp_totals[day] += float(record['frp'])
    return [
        {
            'date': day,
            'total': totals[day],
            'modis': modis_totals[day],
            'viirs': viirs_totals[day],
            'frp_mw_total': round(frp_totals[day], 2),
        }
        for day in sorted(totals)
    ]


def build_trend_series(records: list[dict[str, object]]) -> list[dict[str, object]]:
    series = aggregate_daily(records)
    counts = [int(item['total']) for item in series]
    mean = sum(counts) / len(counts) if counts else 0
    variance = sum((count - mean) ** 2 for count in counts) / len(counts) if counts else 0
    deviation = variance ** 0.5
    return [
        {
            **item,
            'baseline_mean': round(mean, 2),
            'baseline_lower': round(max(0, mean - deviation), 2),
            'baseline_upper': round(mean + deviation, 2),
        }
        for item in series
    ]


def build_sensor_comparison(records: list[dict[str, object]]) -> dict[str, object]:
    modis = sum(1 for r in records if str(r.get('instrument')) == 'MODIS')
    viirs = sum(1 for r in records if str(r.get('instrument')) == 'VIIRS')
    return {
        'labels': ['MODIS', 'VIIRS'],
        'series': [modis, viirs],
        'share': {'MODIS': round(modis / max(modis + viirs, 1) * 100, 1), 'VIIRS': round(viirs / max(modis + viirs, 1) * 100, 1)},
    }


def build_frp_histogram(records: list[dict[str, object]]) -> list[dict[str, object]]:
    bins = (
        ('0–5 MW', 0.0, 5.0),
        ('5–20 MW', 5.0, 20.0),
        ('20–50 MW', 20.0, 50.0),
        ('50+ MW', 50.0, float('inf')),
    )
    values = [
        float(record['frp'])
        for record in records
        if record.get('instrument') in {'MODIS', 'VIIRS'}
        and record.get('frp') is not None
    ]
    return [
        {
            'range': label,
            'count': sum(lower <= value < upper for value in values),
        }
        for label, lower, upper in bins
    ]


def build_diurnal_overpasses(records: list[dict[str, object]]) -> list[dict[str, object]]:
    satellite_aliases = {
        'TERRA': 'Terra',
        'AQUA': 'Aqua',
        'SUOMI-NPP': 'Suomi NPP',
        'S-NPP': 'Suomi NPP',
        'NOAA-20': 'NOAA-20',
        'NOAA20': 'NOAA-20',
        'NOAA-21': 'NOAA-21',
        'NOAA21': 'NOAA-21',
    }
    counts: dict[tuple[int, str], int] = defaultdict(int)
    for record in records:
        if record.get('instrument') not in {'MODIS', 'VIIRS'}:
            continue
        raw_time = str(record.get('acquisition_time') or '').strip()
        if not raw_time.isdigit() or len(raw_time) not in {3, 4, 6}:
            continue
        hour = int(raw_time[:2] if len(raw_time) >= 4 else raw_time[:1])
        if not 0 <= hour <= 23:
            continue
        satellite = str(record.get('satellite') or '').upper().replace(' ', '-')
        satellite = satellite_aliases.get(satellite, satellite.replace('_', '-'))
        counts[(hour, satellite)] += 1
    return [
        {'hour_utc': hour, 'satellite': satellite, 'detections': count}
        for (hour, satellite), count in sorted(counts.items())
    ]


def build_anomaly_flags(records: list[dict[str, object]]) -> list[dict[str, object]]:
    daily = aggregate_daily(records)
    if not daily:
        return []
    values = [int(item['total']) for item in daily]
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = variance ** 0.5
    anomalies = []
    for item in daily:
        z = (int(item['total']) - mean) / std if std else 0
        if abs(z) > 1.5:
            anomalies.append({
                'date': item['date'],
                'total': item['total'],
                'z_score': round(z, 2),
                'baseline_mean': round(mean, 2),
                'baseline_std': round(std, 2),
                'note': 'Statistically unusual relative to the recent rolling baseline; not an emergency confirmation.',
            })
    return anomalies[:10]
