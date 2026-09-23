import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
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
MAX_EXPORT = 5000


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
    limit: int,
) -> list[Event]:
    stmt = select(Event).where(Event.environment == environment).order_by(Event.id.desc())
    if statuses:
        stmt = stmt.where(Event.status.in_(statuses))
    if source:
        stmt = stmt.where(Event.source == source)
    return list(db.execute(stmt.limit(limit)).scalars().all())


def _event_record(event: Event) -> dict:
    return {
        "id": event.id,
        "event_id": event.event_id,
        "status": str(event.status),
        "received_at": event.received_at.isoformat(),
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
    limit: int = Query(default=1000, ge=1, le=MAX_EXPORT),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Download processed logs as a file (json, ndjson, or csv)."""
    fmt = format.strip().lower()
    if fmt not in FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format: {format} (use one of {', '.join(FORMATS)})",
        )
    statuses = _parse_statuses(status)

    events = _collect(db, environment, statuses, source, limit)
    filename = f"simplifyr-events-{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}.{fmt}"

    if fmt == "json":
        content = json.dumps([_event_record(e) for e in events], indent=2)
    elif fmt == "ndjson":
        content = "\n".join(json.dumps(_event_record(e)) for e in events)
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
                    e.received_at.isoformat(),
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
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
