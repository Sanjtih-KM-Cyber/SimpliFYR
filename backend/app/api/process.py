from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.engine import ProcessingEngine
from app.models import BatchRun, Event

from app.schemas.process import BatchItemResult, BatchResponse, BatchRunResponse

router = APIRouter(prefix="/process", tags=["process"])

MAX_BATCH = 100_000


@router.post("/batch", response_model=BatchResponse)
async def process_batch(
    db: Session = Depends(get_db),
    file: UploadFile | None = File(default=None),
    raw: str | None = Form(default=None),
    source: str | None = Form(default=None),
    mapping_id: int | None = Form(default=None),
    output_profile_id: int | None = Form(default=None),
) -> BatchResponse:
    """Process a batch of events (one per line) and report throughput/latency.

    This exercises the same deterministic engine as real-time ingestion and is the
    primary tool for load/throughput measurement at scale.
    """
    if file is not None:
        content = (await file.read()).decode("utf-8", errors="replace")
    elif raw is not None:
        content = raw
    else:
        raise HTTPException(status_code=422, detail="Provide either 'file' or 'raw'")

    from app.core.batch_split import split_batch_content

    lines = split_batch_content(content)
    if not lines:
        raise HTTPException(status_code=422, detail="No events found in payload")
    if len(lines) > MAX_BATCH:
        raise HTTPException(status_code=413, detail="Batch too large")

    run = BatchRun(environment="default", source=source)
    db.add(run)
    db.flush()  # assign id so member events can reference this run

    engine = ProcessingEngine(db)
    results: list[BatchItemResult] = []
    counts = {"normalized": 0, "output": 0, "quarantined": 0, "dlq": 0, "failed": 0}

    # Batched I/O fast path: one mapping resolve, one duplicate prefetch, one
    # flush per 1000 lines (was: one SELECT + one flush per event). Same
    # per-line semantics (status/dedup/quarantine/drift) as N single ingests.
    start = time.perf_counter()
    latencies: list[float] = []
    engine_results = engine.process_lines(
        lines,
        source=source,
        mapping_id=mapping_id,
        output_profile_id=output_profile_id,
        ingestion_type="batch",
    )
    per_event_ms = (time.perf_counter() - start) * 1000 / max(len(lines), 1)
    for index, res in enumerate(engine_results):
        status = res["status"]
        status_value = status.value if hasattr(status, "value") else str(status)
        if status_value in counts:
            counts[status_value] += 1
        detection = res.get("detection")
        results.append(
            BatchItemResult(
                index=index,
                status=status_value,
                detected_format=detection.format.value if detection is not None else "",
                stored_event_id=res.get("stored_event_id"),
                duplicate=bool(res.get("duplicate", False)),
            )
        )
        latencies.append(per_event_ms)
    duration = time.perf_counter() - start

    processed = sum(1 for r in results if r.status != "failed")
    events_per_second = round(processed / duration, 1) if duration > 0 else 0.0
    avg_latency = round(sum(latencies) / len(latencies), 3) if latencies else 0.0

    # Only rows created by this run join it: idempotent replays reference
    # pre-existing events, which keep whatever batch (if any) created them.
    stored_ids = [
        r.stored_event_id for r in results if r.stored_event_id is not None and not r.duplicate
    ]
    if stored_ids:
        db.execute(update(Event).where(Event.id.in_(stored_ids)).values(batch_id=run.id))
    run.total = len(lines)
    run.processed = processed
    run.normalized = counts["normalized"]
    run.output = counts["output"]
    run.quarantined = counts["quarantined"]
    run.dlq = counts["dlq"]
    run.failed = counts["failed"]
    run.duration_seconds = round(duration, 4)
    db.commit()
    db.refresh(run)

    return BatchResponse(
        total=len(lines),
        processed=processed,
        normalized=counts["normalized"],
        output=counts["output"],
        quarantined=counts["quarantined"],
        dlq=counts["dlq"],
        failed=counts["failed"],
        duration_seconds=round(duration, 4),
        events_per_second=events_per_second,
        avg_latency_ms=avg_latency,
        results=results,
        batch_id=run.id,
    )


def _run_to_response(
    run: BatchRun, live_normalized: int = 0, live_held: int = 0
) -> BatchRunResponse:
    return BatchRunResponse(
        id=run.id,
        source=run.source,
        total=run.total,
        processed=run.processed,
        normalized=run.normalized,
        output=run.output,
        quarantined=run.quarantined,
        dlq=run.dlq,
        failed=run.failed,
        duration_seconds=run.duration_seconds,
        created_at=run.created_at,
        live_normalized=live_normalized,
        live_held=live_held,
    )


@router.get("/batches", response_model=list[BatchRunResponse])
def list_batches(
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Recent batch runs, newest first — one row per set parsed at one time."""
    from sqlalchemy import func

    runs = (
        db.execute(select(BatchRun).order_by(BatchRun.id.desc()).limit(limit)).scalars().all()
    )
    live: dict[int, dict[str, int]] = {}
    if runs:
        for batch_id, status, count in db.execute(
            select(Event.batch_id, Event.status, func.count(Event.id))
            .where(Event.batch_id.in_([r.id for r in runs]))
            .group_by(Event.batch_id, Event.status)
        ).all():
            entry = live.setdefault(batch_id, {"normalized": 0, "held": 0})
            if str(status) in ("normalized", "output"):
                entry["normalized"] += count
            elif str(status) in ("quarantined", "dlq"):
                entry["held"] += count
    return [
        _run_to_response(
            r,
            live_normalized=live.get(r.id, {}).get("normalized", 0),
            live_held=live.get(r.id, {}).get("held", 0),
        )
        for r in runs
    ]


class BatchGroupResponse(BaseModel):
    key: str
    format: str
    fields: list[str]
    count: int
    held: int
    rep_id: int | None
    event_ids: list[int]
    truncated: bool


_GROUP_IDS_CAP = 10_000


@router.get("/batches/{batch_id}/groups", response_model=list[BatchGroupResponse])
def batch_groups(batch_id: int, db: Session = Depends(get_db)):
    """Deduplicated log types inside one upload (one row per field-shape).

    Held (quarantined/dlq) lines are included in their type group with the
    lossless fallback — a type is a shape, not a status. `event_ids` pins
    the exact set for per-type download (capped at 10k ids; larger groups
    download via the whole-batch export instead).
    """
    from app.core.normalized_view import field_keys

    run = db.get(BatchRun, batch_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Batch not found")
    rows = (
        db.execute(select(Event).where(Event.batch_id == batch_id).order_by(Event.id))
        .scalars()
        .all()
    )
    buckets: dict[tuple, dict] = {}
    order: list[tuple] = []
    for event in rows:
        fmt = str(event.detected_format or "unknown").lower()
        try:
            fields = tuple(field_keys(event.parsed))
        except Exception:
            fields = ()
        key = (fmt, fields)
        bucket = buckets.get(key)
        if bucket is None:
            bucket = {"ids": [], "held": 0, "rep_id": None}
            buckets[key] = bucket
            order.append(key)
        bucket["ids"].append(event.id)
        if bucket["rep_id"] is None:
            bucket["rep_id"] = event.id
        if str(event.status) in ("quarantined", "dlq"):
            bucket["held"] += 1
    groups: list[BatchGroupResponse] = []
    for fmt, fields in order:
        bucket = buckets[(fmt, fields)]
        ids = bucket["ids"]
        truncated = len(ids) > _GROUP_IDS_CAP
        groups.append(
            BatchGroupResponse(
                key=f"{fmt}::{','.join(fields)}",
                format=fmt,
                fields=list(fields),
                count=len(ids),
                held=bucket["held"],
                rep_id=bucket["rep_id"],
                event_ids=ids[:_GROUP_IDS_CAP],
                truncated=truncated,
            )
        )
    return groups