from __future__ import annotations

import csv
import io
import json
from datetime import datetime, timezone


def _coordinate(value: object) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        return float(value)
    raise ValueError('Observation coordinates must be numeric.')


def build_csv_export(records: list[dict[str, object]]) -> str:
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            'observation_id',
            'latitude',
            'longitude',
            'acquisition_date',
            'acquisition_time',
            'instrument',
            'satellite',
            'product',
            'brightness_temperature',
            'frp',
            'confidence',
            'day_night',
            'processing_type',
            'source',
            'feed',
            'event_id',
            'event_title',
            'event_url',
            'event_magnitude',
            'event_magnitude_unit',
            'event_source_url',
        ],
    )
    writer.writeheader()
    for record in records:
        writer.writerow({
            'observation_id': record.get('observation_id', ''),
            'latitude': record.get('latitude', ''),
            'longitude': record.get('longitude', ''),
            'acquisition_date': record.get('acquisition_date', ''),
            'acquisition_time': record.get('acquisition_time', ''),
            'instrument': record.get('instrument', ''),
            'satellite': record.get('satellite', ''),
            'product': record.get('product', ''),
            'brightness_temperature': record.get('brightness_temperature', ''),
            'frp': record.get('frp', ''),
            'confidence': record.get('confidence', ''),
            'day_night': record.get('day_night', ''),
            'processing_type': record.get('processing_type', ''),
            'source': record.get('source', ''),
            'feed': record.get('feed', ''),
            'event_id': record.get('event_id', ''),
            'event_title': record.get('event_title', ''),
            'event_url': record.get('event_url', ''),
            'event_magnitude': record.get('event_magnitude', ''),
            'event_magnitude_unit': record.get('event_magnitude_unit', ''),
            'event_source_url': record.get('event_source_url', ''),
        })
    return output.getvalue()


def build_geojson(records: list[dict[str, object]]) -> str:
    features = []
    for record in records:
        source_geometry = record.get('geometry')
        geometry = {
            key: source_geometry[key]
            for key in ('type', 'coordinates')
            if isinstance(source_geometry, dict) and key in source_geometry
        } or {
            'type': 'Point',
            'coordinates': [
                _coordinate(record['longitude']),
                _coordinate(record['latitude']),
            ],
        }
        features.append({
            'type': 'Feature',
            'geometry': geometry,
            'properties': {
                'observation_id': record.get('observation_id'),
                'instrument': record.get('instrument'),
                'satellite': record.get('satellite'),
                'product': record.get('product'),
                'frp': record.get('frp'),
                'confidence': record.get('confidence'),
                'acquisition_date': record.get('acquisition_date'),
                'source': record.get('source'),
                'feed': record.get('feed'),
                'event_id': record.get('event_id'),
                'event_title': record.get('event_title'),
                'event_url': record.get('event_url'),
                'event_magnitude': record.get('event_magnitude'),
                'event_magnitude_unit': record.get('event_magnitude_unit'),
                'event_source_url': record.get('event_source_url'),
            },
        })
    return json.dumps({'type': 'FeatureCollection', 'features': features}, indent=2)


def generate_report_summary(records: list[dict[str, object]], region: str, sensors: list[str]) -> dict[str, object]:
    total = len(records)
    modis = sum(1 for r in records if str(r.get('instrument')) == 'MODIS')
    viirs = sum(1 for r in records if str(r.get('instrument')) == 'VIIRS')
    return {
        'region': region,
        'sensors': sensors,
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'total_records': total,
        'modis_records': modis,
        'viirs_records': viirs,
        'notes': 'Report values are aggregated from the active record set and are not ground-truth fire confirmation.',
    }
