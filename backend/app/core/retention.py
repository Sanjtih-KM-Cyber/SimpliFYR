from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.raw_store import get_raw_store
from app.models import AuditLog, Event

logger = logging.getLogger("simplifyr.retention")


def _cutoff(days: int) -> datetime:
    return datetime.now(timezone.utc) - timedelta(days=days)


def _delete_raw_file(event: Event) -> None:
    if not event.raw_ref:
        return
    try:
        get_raw_store().delete(event.raw_ref)
    except Exception:  # noqa: BLE001
        logger.warning("Could not remove raw file %s", event.raw_ref)
    event.raw_ref = None


def run_retention_cleanup(
    db: Session,
    retention_days: int | None = None,
    raw_retention_days: int | None = None,
    audit_retention_days: int | None = None,
) -> int:
    """Apply tiered retention (§59): raw files, event rows, audit rows.

    - Raw tier: events older than the raw window lose their raw *file*
      (the row and inline `raw` text stay, so detail views keep working).
    - Events tier: event rows older than the window are deleted with files.
    - Audit tier: audit log rows older than the window are deleted.

    An explicit `retention_days` preserves the legacy single-window behavior
    (full event delete); otherwise the legacy `RETENTION_DAYS` setting
    overrides the normalized tier when > 0. All windows default to 0
    (disabled) unless configured. Returns total rows removed.
    """
    raw_window = raw_retention_days if raw_retention_days is not None else settings.raw_retention_days
    if retention_days is not None:
        events_window = retention_days
    elif settings.retention_days > 0:
        events_window = settings.retention_days
    else:
        events_window = settings.normalized_retention_days
    audit_window = audit_retention_days if audit_retention_days is not None else settings.audit_retention_days
    removed = 0

    if raw_window > 0:
        cutoff = _cutoff(raw_window)
        aged = (
            db.execute(
                select(Event).where(Event.received_at < cutoff, Event.raw_ref.isnot(None))
            )
            .scalars()
            .all()
        )
        for event in aged:
            _delete_raw_file(event)
        if aged:
            db.commit()
            logger.info("Retention: stripped %d raw files older than %s", len(aged), cutoff)

    if events_window > 0:
        cutoff = _cutoff(events_window)
        events = db.execute(select(Event).where(Event.received_at < cutoff)).scalars().all()
        for event in events:
            _delete_raw_file(event)
            db.delete(event)
            removed += 1
        if events:
            db.commit()
            logger.info("Retention: removed %d events older than %s", len(events), cutoff)

    if audit_window > 0:
        cutoff = _cutoff(audit_window)
        audits = db.execute(select(AuditLog).where(AuditLog.created_at < cutoff)).scalars().all()
        for entry in audits:
            db.delete(entry)
            removed += 1
        if audits:
            db.commit()
            logger.info("Retention: removed %d audit rows older than %s", len(audits), cutoff)

    return removed
