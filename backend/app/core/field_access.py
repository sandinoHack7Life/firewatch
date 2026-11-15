from __future__ import annotations

import secrets


MIN_FIELD_ACCESS_KEY_LENGTH = 32


def has_valid_field_access_key(configured_key: str, supplied_key: str | None) -> bool:
    return (
        len(configured_key) >= MIN_FIELD_ACCESS_KEY_LENGTH
        and supplied_key is not None
        and secrets.compare_digest(configured_key, supplied_key)
    )
