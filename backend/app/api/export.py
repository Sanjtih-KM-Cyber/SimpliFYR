import csv
import io
import json
import re
from collections.abc import Iterator
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.datetimes import as_utc_iso
from app.core.environment import get_environment

from app.models import BatchRun, Event, EventStatus, Mapping

router = APIRouter(prefix="/export", tags=["export"])

FORMATS = ("json", "ndjson", "csv")
SHAPES = ("full", "normalized")
PAYLOADS = ("normalized", "output")
_MEDIA_TYPES = {
    "json": "application/json",
    "ndjson": "application/x-ndjson",
    "csv": "text/csv",
}


def _slug(value: str | None) -> str:
    """Filesystem-safe filename fragment (mapping/source names are free text)."""
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "").lower()).strip("-")[:60]
    return slug or "export"


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


_CHUNK = 2000


def _base_filters(
    environment: str,
    statuses: list[EventStatus],
    source: str | None,
    batch_id: int | None,
):
    """Shared WHERE clause so counts and streamed pages can never disagree."""
    filters = [Event.environment == environment]
    if statuses:
        filters.append(Event.status.in_(statuses))
    if source:
        filters.append(Event.source == source)
    if batch_id is not None:
        filters.append(Event.batch_id == batch_id)
    return filters


def _count_matching(
    db: Session,
    environment: str,
    statuses: list[EventStatus],
    source: str | None,
    batch_id: int | None,
    ids: list[int] | None,
    limit: int | None,
) -> tuple[int, int]:
    """Upfront (total, normalized) counts for filenames, meta, and headers."""
    if ids is not None:
        wanted = ids[:limit] if limit is not None else ids
        if not wanted:
            return 0, 0
        id_filter = [Event.id.in_(wanted)]
        if batch_id is not None:
            id_filter.append(Event.batch_id == batch_id)
        total = db.execute(
            select(func.count(Event.id)).where(*id_filter)
        ).scalar() or 0
        normalized = db.execute(
            select(func.count(Event.id)).where(
                *id_filter,
                Event.status.in_((EventStatus.NORMALIZED, EventStatus.OUTPUT)),
            )
        ).scalar() or 0
        return total, normalized
    total_stmt = select(func.count(Event.id)).where(
        *_base_filters(environment, statuses, source, batch_id)
    )
    total_full = db.execute(total_stmt).scalar() or 0
    total = min(total_full, limit) if limit is not None else total_full
    norm_stmt = select(func.count(Event.id)).where(
        *_base_filters(environment, statuses, source, batch_id),
        Event.status.in_((EventStatus.NORMALIZED, EventStatus.OUTPUT)),
    )
    normalized_full = db.execute(norm_stmt).scalar() or 0
    normalized = min(normalized_full, limit) if limit is not None else normalized_full
    return total, normalized


def _iter_record_dicts(
    environment: str,
    statuses: list[EventStatus],
    source: str | None,
    batch_id: int | None,
    limit: int | None,
    ids: list[int] | None,
) -> Iterator[dict]:
    """Stream matching events as plain dicts in id-DESC order, bounded memory.

    Each chunk runs in its own short-lived session (no long transaction is
    ever held open); rows are materialized to dicts inside the session so
    nothing lazy is touched after close. Pinned `ids` keep their set
    semantics; otherwise keyset pagination walks newest-first.
    """
    from app.core.database import SessionLocal as _SessionLocal

    yielded = 0

    if ids is not None:
        wanted = ids[:limit] if limit is not None else ids
        for start in range(0, len(wanted), _CHUNK):
            chunk = wanted[start : start + _CHUNK]
            with _SessionLocal() as sdb:
                chunk_stmt = select(Event).where(Event.id.in_(chunk))
                if batch_id is not None:
                    chunk_stmt = chunk_stmt.where(Event.batch_id == batch_id)
                rows = list(
                    sdb.execute(chunk_stmt.order_by(Event.id.desc())).scalars().all()
                )
                records = [_event_record(e) for e in rows]
            for record in records:
                yield record
                yielded += 1
        return

    last_id: int | None = None
    while True:
        with _SessionLocal() as sdb:
            stmt = select(Event).where(
                *_base_filters(environment, statuses, source, batch_id)
            )
            if last_id is not None:
                stmt = stmt.where(Event.id < last_id)
            stmt = stmt.order_by(Event.id.desc()).limit(_CHUNK)
            rows = list(sdb.execute(stmt).scalars().all())
            records = [_event_record(e) for e in rows]
        if not records:
            break
        for record in records:
            if limit is not None and yielded >= limit:
                return
            yield record
            yielded += 1
        last_id = rows[-1].id


def _event_record(event: Event) -> dict:
    return {
        "id": event.id,
        "event_id": event.event_id,
        "status": str(event.status),
        "received_at": as_utc_iso(event.received_at),
        "source": event.source,
        "batch_id": event.batch_id,
        "raw": event.raw,
        "parsed": event.parsed,
        "normalized": event.normalized,
        "output": event.output,
    }


def _slim_record(record: dict, payload: str = "normalized") -> dict:
    """Normalized-only export row: the mapped payload plus traceability.

    Drops raw/parsed/output so the file answers "what came out of
    Simplifyr?" — `normalized` may be None for quarantined rows, in which
    case the row still carries id/source/status for follow-up.

    `payload="output"` emits the output-profile result (`event.output`,
    i.e. the exact structure of the selected/bound profile) under the
    `output` key instead of the generic `normalized` payload — falling back
    to `normalized` for rows that never passed through a profile, so no
    event is ever dropped from the complete set.
    """
    if payload == "output":
        rendered = record.get("output")
        if rendered is None:
            rendered = record.get("normalized")
        return {
            "id": record["id"],
            "event_id": record["event_id"],
            "source": record["source"],
            "status": record["status"],
            "received_at": record["received_at"],
            "batch_id": record.get("batch_id"),
            "output": rendered,
        }
    return {
        "id": record["id"],
        "event_id": record["event_id"],
        "source": record["source"],
        "status": record["status"],
        "received_at": record["received_at"],
        "batch_id": record.get("batch_id"),
        "normalized": record.get("normalized"),
    }


def _numbered(records: Iterator[dict]) -> Iterator[dict]:
    """Stamp each export row with its 0-based position in the stream.

    Exports are ordered (id-DESC), so `seq` numbers every row of the
    complete dataset — no sampling, no collapsing, verifiable N-in/N-out.
    """
    for seq, record in enumerate(records):
        yield {"seq": seq, **record}


def _mapping_name_for_source(db: Session, source: str | None) -> str | None:
    """Simplifyr name for a source: the mapping configured for it, if any."""
    if not source:
        return None
    return db.execute(
        select(Mapping.name).where(Mapping.source == source).limit(1)
    ).scalar()


def _export_scope(
    db: Session,
    source: str | None,
    batch_id: int | None,
    wanted: list[int] | None,
    total: int,
) -> tuple[str, str | None]:
    """Descriptive filename scope + mapping name: what is inside, addressed
    by its Simplifyr name (mapping), index (batch id / record id), and count.
    """
    if batch_id is not None:
        batch_source = db.execute(
            select(BatchRun.source).where(BatchRun.id == batch_id)
        ).scalar()
        mapping_name = _mapping_name_for_source(db, batch_source)
        base = _slug(mapping_name) if mapping_name else "batch"
        return f"{base}-batch-{batch_id}", mapping_name
    if wanted:
        sample_sources = db.execute(
            select(Event.source).where(Event.id.in_(wanted[:50])).limit(5)
        ).scalars().all()
        mapping_name = _mapping_name_for_source(
            db, next((s for s in sample_sources if s), None)
        )
        base = _slug(mapping_name) if mapping_name else "selection"
        if len(wanted) == 1:
            return f"{base}-index-{wanted[0]:06d}", mapping_name
        return f"{base}-{total}records", mapping_name
    if source:
        mapping_name = _mapping_name_for_source(db, source)
        base = _slug(mapping_name) if mapping_name else _slug(source)
        return f"{base}-{total}records", mapping_name
    return f"all-{total}records", None


@router.get("")
def export_events(
    format: str = Query(default="json"),
    shape: str = Query(default="normalized", description="Row shape: normalized (slim) or full (diagnostic)"),
    payload: str = Query(
        default="normalized",
        description="Slim payload: normalized (generic mapped result) or output (selected/bound output-profile result)",
    ),
    status: str | None = Query(default=None),
    source: str | None = Query(default=None),
    batch_id: int | None = Query(default=None, description="Batch run id: export exactly this run"),
    limit: int | None = Query(default=None, ge=1),
    ids: str | None = Query(default=None, description="Comma-separated event row ids: export exactly this set"),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Download processed logs as a file (json, ndjson, or csv).

    Default `shape=normalized` returns the slim row: traceability
    (id/event_id/source/status/received_at/batch/mapping) plus the mapped
    `normalized` payload only — no raw input text. `payload=output` swaps the
    payload to the selected/bound output-profile result (`output`, falling
    back to `normalized` where no profile applied) without changing which
    rows ship. `shape=full` keeps the legacy diagnostic row
    (raw/parsed/output) for debugging. `limit`
    omitted = the whole matching set, uncapped. Counts travel in the
    filename, the JSON meta block, and X-Export-* headers. `ids` pins the
    export to an explicit set (e.g. one trial run's rows); `batch_id` pins
    it to one batch run (e.g. the batch index the user clicked).
    """
    fmt = format.strip().lower()
    if fmt not in FORMATS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported format: {format} (use one of {', '.join(FORMATS)})",
        )
    shape_key = (shape or "normalized").strip().lower()
    if shape_key not in SHAPES:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported shape: {shape} (use one of {', '.join(SHAPES)})",
        )
    slim = shape_key == "normalized"
    payload_key = (payload or "normalized").strip().lower()
    if payload_key not in PAYLOADS:
        raise HTTPException(
            status_code=422,
            detail=f"Unsupported payload: {payload} (use one of {', '.join(PAYLOADS)})",
        )
    statuses = _parse_statuses(status)
    wanted: list[int] | None = None
    if ids:
        try:
            wanted = [int(p) for p in ids.split(",") if p.strip()]
        except ValueError:
            raise HTTPException(status_code=422, detail="ids must be comma-separated integers")
        if len(wanted) > 10_000:
            raise HTTPException(status_code=422, detail="ids set too large (max 10000)")

    total, normalized_count = _count_matching(
        db, environment, statuses, source, batch_id, wanted, limit
    )

    scope, mapping_name = _export_scope(db, source, batch_id, wanted, total)
    shape_tag = "normalized" if slim else "full"
    payload_tag = "-output" if slim and payload_key == "output" else ""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    filename = f"simplifyr-{scope}-{shape_tag}{payload_tag}-{normalized_count}normalized-{stamp}.{fmt}"
    meta = {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "shape": shape_key,
        "payload": payload_key,
        "count": total,
        "normalized_count": normalized_count,
        "source": source,
        "batch_id": batch_id,
        "mapping": mapping_name,
        "statuses": [str(s) for s in statuses],
    }

    def generate() -> Iterator[str]:
        records = _iter_record_dicts(environment, statuses, source, batch_id, limit, wanted)
        if slim:
            records = _numbered(_slim_record(r, payload_key) for r in records)
        if fmt == "json":
            yield '{"meta": ' + json.dumps(meta) + ', "events": ['
            first = True
            for record in records:
                if not first:
                    yield ","
                first = False
                yield json.dumps(record)
            yield "]}"
        elif fmt == "ndjson":
            for record in records:
                yield json.dumps(record) + "\n"
        else:
            if slim:
                # Slim CSV: traceability columns + one normalized-JSON
                # column. A single JSON column keeps streaming exact:
                # flattened dotted headers would need the full key union
                # upfront, which either loads everything into memory or
                # risks silently dropping late-appearing keys mid-stream.
                buf = io.StringIO()
                writer = csv.writer(buf)
                writer.writerow(
                    [
                        "seq",
                        "id",
                        "event_id",
                        "source",
                        "status",
                        "received_at",
                        "batch_id",
                        payload_key,
                    ]
                )
                yield buf.getvalue()
                for record in records:
                    buf = io.StringIO()
                    writer = csv.writer(buf)
                    writer.writerow(
                        [
                            record["seq"],
                            record["id"],
                            record["event_id"] or "",
                            record["source"] or "",
                            record["status"],
                            record["received_at"] or "",
                            record.get("batch_id") or "",
                            (
                                json.dumps(record.get(payload_key))
                                if record.get(payload_key) is not None
                                else ""
                            ),
                        ]
                    )
                    yield buf.getvalue()
            else:
                buf = io.StringIO()
                writer = csv.writer(buf)
                writer.writerow(["id", "event_id", "status", "received_at", "source", "raw", "parsed", "normalized"])
                yield buf.getvalue()
                for record in records:
                    buf = io.StringIO()
                    writer = csv.writer(buf)
                    writer.writerow(
                        [
                            record["id"],
                            record["event_id"],
                            record["status"],
                            record["received_at"],
                            record["source"] or "",
                            record["raw"],
                            json.dumps(record["parsed"]) if record["parsed"] is not None else "",
                            json.dumps(record["normalized"]) if record["normalized"] is not None else "",
                        ]
                    )
                    yield buf.getvalue()

    return StreamingResponse(
        generate(),
        media_type=_MEDIA_TYPES[fmt],
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "X-Export-Total": str(total),
            "X-Export-Normalized": str(normalized_count),
        },
    )
