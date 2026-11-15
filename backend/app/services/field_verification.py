from __future__ import annotations

from typing import Any


def annotate_observations(
    records: list[dict[str, Any]],
    visits: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    latest_by_detection: dict[tuple[str, str], dict[str, Any]] = {}
    for visit in visits:
        observation_id = visit.get('satellite_observation_id')
        feed = visit.get('satellite_feed')
        if not observation_id or not feed:
            continue
        key = (str(feed), str(observation_id))
        existing = latest_by_detection.get(key)
        if existing is None or str(visit.get('updated_at_utc', '')) > str(existing.get('updated_at_utc', '')):
            latest_by_detection[key] = visit

    annotated = []
    for record in records:
        visit = latest_by_detection.get((
            str(record.get('feed') or ''),
            str(record.get('observation_id') or ''),
        ))
        if visit is None:
            annotated.append(record)
            continue
        annotated.append({
            **record,
            'field_verification_status': visit.get('status'),
            'field_verification_result': visit.get('observed_result'),
            'field_report_reference': visit.get('report_reference'),
        })
    return annotated


def verified_detection_count(
    records: list[dict[str, Any]],
    visits: list[dict[str, Any]],
) -> int:
    record_keys = {
        (str(record.get('feed') or ''), str(record.get('observation_id') or ''))
        for record in records
    }
    return len({
        (str(visit.get('satellite_feed') or ''), str(visit.get('satellite_observation_id') or ''))
        for visit in visits
        if visit.get('status') == 'completed'
        and visit.get('satellite_feed')
        and visit.get('satellite_observation_id')
        and (
            str(visit['satellite_feed']),
            str(visit['satellite_observation_id']),
        ) in record_keys
    })
