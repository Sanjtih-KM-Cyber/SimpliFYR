"""Timezone helpers (Phase 6 fix).

SQLite drops tzinfo: `DateTime(timezone=True)` values written by
`utcnow()` come back naive. Serialized bare, a browser reads them as LOCAL
time — displaying UTC wall-clock as if local (5:30 off in IST). Every API
boundary must pass datetimes through `as_utc()` so ISO output carries
+00:00 and browsers convert to the viewer's real local time.
"""

from __future__ import annotations

from datetime import datetime, timezone


def as_utc(value: datetime | None) -> datetime | None:
    """Attach UTC to naive datetimes; pass through aware/None untouched."""
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def as_utc_iso(value: datetime | None) -> str | None:
    """ISO-8601 string guaranteed to carry an offset (or None)."""
    stamped = as_utc(value)
    return stamped.isoformat() if stamped is not None else None
