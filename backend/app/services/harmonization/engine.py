from __future__ import annotations

from collections import defaultdict
from datetime import datetime
from math import asin, cos, radians, sin, sqrt


def normalize_record(raw: dict[str, object]) -> dict[str, object]:
    return {
        'observation_id': str(raw.get('observation_id') or raw.get('id') or 'unknown'),
        'latitude': float(raw.get('latitude') or 0.0),
        'longitude': float(raw.get('longitude') or 0.0),
        'acquisition_date': str(raw.get('acquisition_date') or raw.get('acq_date') or ''),
        'acquisition_time': str(raw.get('acquisition_time') or raw.get('acq_time') or ''),
        'satellite': str(raw.get('satellite') or 'Unknown'),
        'instrument': str(raw.get('instrument') or raw.get('sensor') or 'Unknown'),
        'product': str(raw.get('product') or raw.get('dataset') or 'Unknown'),
        'brightness_temperature': float(raw.get('brightness_temperature')) if raw.get('brightness_temperature') is not None else None,
        'brightness_temperature_2': float(raw.get('brightness_temperature_2')) if raw.get('brightness_temperature_2') is not None else None,
        'frp': float(raw.get('frp')) if raw.get('frp') is not None else None,
        'confidence': raw.get('confidence') if raw.get('confidence') is not None else None,
        'day_night': str(raw.get('day_night') or raw.get('daynight') or 'U'),
        'processing_type': str(raw.get('processing_type') or raw.get('processing') or 'unknown'),
        'source': str(raw.get('source') or 'NASA FIRMS'),
        'original_source': str(raw.get('original_source') or raw.get('source') or 'NASA FIRMS'),
        'version': str(raw.get('version') or 'unknown'),
    }


def harmonization_summary(records: list[dict[str, object]]) -> dict[str, object]:
    normalized = [
        normalize_record(record)
        for record in records
        if record.get('instrument') in {'MODIS', 'VIIRS'}
    ]
    modis = [r for r in normalized if r['instrument'] == 'MODIS']
    viirs = [r for r in normalized if r['instrument'] == 'VIIRS']
    total = len(normalized)
    def mean_frp(sensor_records: list[dict[str, object]]) -> float | None:
        values = [float(record['frp']) for record in sensor_records if record['frp'] is not None]
        return round(sum(values) / len(values), 2) if values else None

    spatial_by_sensor: dict[str, float | None] = {
        'MODIS': mean_frp(modis),
        'VIIRS': mean_frp(viirs),
    }
    by_day: dict[str, int] = defaultdict(int)
    for r in normalized:
        day = str(r['acquisition_date'])
        by_day[day] += 1
    return {
        'total_observations': total,
        'modis_observations': len(modis),
        'viirs_observations': len(viirs),
        'combined_average_frp': mean_frp(normalized),
        'average_frp_by_sensor': spatial_by_sensor,
        'temporal_coverage_days': len(by_day),
        'methodology_note': 'Observation counts are reported separately by sensor; raw detections are preserved and not reduced to a synthetic true-fire signal.',
    }


def _acquisition_datetime(record: dict[str, object]) -> datetime | None:
    day = str(record.get('acquisition_date') or '')
    raw_time = str(record.get('acquisition_time') or '').strip()
    if len(raw_time) == 4 and raw_time.isdigit():
        raw_time = f'{raw_time[:2]}:{raw_time[2:]}'
    if not raw_time:
        raw_time = '00:00'
    try:
        return datetime.fromisoformat(f'{day}T{raw_time}')
    except ValueError:
        return None


def _distance_km(left: dict[str, object], right: dict[str, object]) -> float:
    latitude_left = radians(float(left['latitude']))
    latitude_right = radians(float(right['latitude']))
    latitude_delta = latitude_right - latitude_left
    longitude_delta = radians(float(right['longitude']) - float(left['longitude']))
    value = (
        sin(latitude_delta / 2) ** 2
        + cos(latitude_left) * cos(latitude_right) * sin(longitude_delta / 2) ** 2
    )
    return 6371.0088 * 2 * asin(min(1.0, sqrt(value)))


def build_potential_matches(
    records: list[dict[str, object]],
    spatial_threshold_km: float = 1.5,
    time_threshold_hours: int = 12,
) -> list[dict[str, object]]:
    normalized = [normalize_record(r) for r in records]
    matches: list[dict[str, object]] = []
    for i, left in enumerate(normalized):
        for right in normalized[i + 1:]:
            if (
                left['instrument'] not in {'MODIS', 'VIIRS'}
                or right['instrument'] not in {'MODIS', 'VIIRS'}
                or left['instrument'] == right['instrument']
            ):
                continue
            left_dt = _acquisition_datetime(left)
            right_dt = _acquisition_datetime(right)
            if left_dt is None or right_dt is None:
                continue
            distance_km = _distance_km(left, right)
            dt = abs((left_dt - right_dt).total_seconds() / 3600)
            if distance_km <= spatial_threshold_km and dt <= time_threshold_hours:
                modis = left if left['instrument'] == 'MODIS' else right
                viirs = right if left['instrument'] == 'MODIS' else left
                matches.append({
                    'left_observation_id': modis['observation_id'],
                    'right_observation_id': viirs['observation_id'],
                    'distance_km': round(distance_km, 3),
                    'time_delta_hours': round(dt, 2),
                    'spatial_threshold_km': spatial_threshold_km,
                    'temporal_threshold_hours': time_threshold_hours,
                    'uncertainty_note': 'Proximity-based cross-sensor association only; not a validated physical equivalence or fire confirmation.',
                })
    return matches[:50]
