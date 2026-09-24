import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.datetimes import as_utc_iso
from app.core.environment import get_environment
from app.core.security import require_auth
from app.models import Event, EventStatus

router = APIRouter(prefix="/export", tags=["export"], dependencies=[Depends(require_auth)])

FORMATS = ("json", "ndjson", "csv")
_MEDIA_TYPES = {
    "json": "application/json",
    "ndjson": "application/x-ndjson",
    "csv": "text/csv",
}


def _parse_statuses(status: str | None) -> list[EventStatus]:
    if not status:
        return []
    statuses = []
    for part in status.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            statuses.append(EventStatus(part))
        except ValueError:
            raise HTTPException(status_code=422, detail=f"Unsupported status: {part}")
    return statuses


def _collect(
    db: Session,
    environment: str,
    statuses: list[EventStatus],
    source: str | None,
    limit: int | None,
) -> list[Event]:
    stmt = select(Event).where(Event.environment == environment).order_by(Event.id.desc())
    if statuses:
        stmt = stmt.where(Event.status.in_(statuses))
    if source:
        stmt = stmt.where(Event.source == source)
    if limit is not None:
        stmt = stmt.limit(limit)
    return list(db.execute(stmt).scalars().all())


def _event_record(event: Event) -> dict:
    return {
        "id": event.id,
        "event_id": event.event_id,
        "status": str(event.status),
        "received_at": as_utc_iso(event.received_at),
        "source": event.source,
        "raw": event.raw,
        "parsed": event.parsed,
        "normalized": event.normalized,
        "output": event.output,
    }


@router.get("")
def export_events(
    format: str = Query(default="json"),
    status: str | None = Query(default=None),
    source: str | None = Query(default=None),
    limit: int | None = Query(default=None, ge=1),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Download processed logs as a file (json, ndjson, or csv).

    `limit` omitted = the whole matching set, uncapped: an export of
    normalized logs always contains every normalized log. Counts travel in
    the filename, the JSON meta block, and X-Export-* headers.
    """
    fmt = format.strip().lower()
    if fmt not in FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format: {format} (use one of {', '.join(FORMATS)})",
        )
    statuses = _parse_statuses(status)

    events = _collect(db, environment, statuses, source, limit)
    records = [_event_record(e) for e in events]
    normalized_count = sum(1 for e in events if e.status in (EventStatus.NORMALIZED, EventStatus.OUTPUT))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"simplifyr-events-{len(events)}total-{normalized_count}normalized-{stamp}.{fmt}"
    meta = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "count": len(events),
        "normalized_count": normalized_count,
        "source": source,
        "statuses": [str(s) for s in statuses],
    }

    if fmt == "json":
        content = json.dumps({"meta": meta, "events": records}, indent=2)
    elif fmt == "ndjson":
        content = "\n".join(json.dumps(r) for r in records)
    else:
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["id", "event_id", "status", "received_at", "source", "raw", "parsed", "normalized"])
        for e in events:
            writer.writerow(
                [
                    e.id,
                    e.event_id,
                    str(e.status),
                    as_utc_iso(e.received_at),
                    e.source or "",
                    e.raw,
                    json.dumps(e.parsed) if e.parsed is not None else "",
                    json.dumps(e.normalized) if e.normalized is not None else "",
                ]
            )
        content = buf.getvalue()

    return Response(
        content=content,
        media_type=_MEDIA_TYPES[fmt],
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Total": str(len(events)),
            "X-Export-Normalized": str(normalized_count),
        },
    )
