from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.engine import ProcessingEngine
from app.core.security import require_auth, require_write
from app.schemas.process import BatchItemResult, BatchResponse

router = APIRouter(prefix="/process", tags=["process"], dependencies=[Depends(require_auth)])

MAX_BATCH = 100_000


@router.post("/batch", response_model=BatchResponse, dependencies=[Depends(require_write)])
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

    lines = [ln.strip() for ln in content.splitlines() if ln.strip()]
    if not lines:
        raise HTTPException(status_code=422, detail="No events found in payload")
    if len(lines) > MAX_BATCH:
        raise HTTPException(status_code=413, detail="Batch too large")

    engine = ProcessingEngine(db)
    results: list[BatchItemResult] = []
    counts = {"normalized": 0, "output": 0, "quarantined": 0, "dlq": 0, "failed": 0}

    # Commit in chunks instead of once per event: at 100k lines, per-event
    # commits dominate latency. Rows are flushed per event (PKs assigned, dedup
    # stays exact); durability is checkpointed every 500.
    start = time.perf_counter()
    latencies: list[float] = []
    for index, line in enumerate(lines):
        t0 = time.perf_counter()
        try:
            res = engine.process_payload(
                line,
                source=source,
                mapping_id=mapping_id,
                output_profile_id=output_profile_id,
                ingestion_type="batch",
                commit=False,
            )
            status = res["status"].value
            if status in counts:
                counts[status] += 1
            results.append(
                BatchItemResult(
                    index=index,
                    status=status,
                    detected_format=res["detection"].format.value,
                    stored_event_id=res.get("stored_event_id"),
                )
            )
        except Exception:
            counts["failed"] += 1
            results.append(BatchItemResult(index=index, status="failed", detected_format=""))
        latencies.append((time.perf_counter() - t0) * 1000)
        if (index + 1) % 500 == 0:
            db.commit()
    db.commit()
    duration = time.perf_counter() - start

    processed = sum(1 for r in results if r.status != "failed")
    events_per_second = round(processed / duration, 1) if duration > 0 else 0.0
    avg_latency = round(sum(latencies) / len(latencies), 3) if latencies else 0.0

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
    )