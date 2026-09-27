from datetime import datetime

from pydantic import BaseModel


class BatchItemResult(BaseModel):
    index: int
    status: str
    detected_format: str
    stored_event_id: int | None = None
    duplicate: bool = False


class BatchResponse(BaseModel):
    total: int
    processed: int
    normalized: int
    output: int
    quarantined: int
    dlq: int = 0
    failed: int
    duration_seconds: float
    events_per_second: float
    avg_latency_ms: float
    results: list[BatchItemResult]
    batch_id: int | None = None


class BatchRunResponse(BaseModel):
    id: int
    source: str | None = None
    total: int
    processed: int
    normalized: int
    output: int
    quarantined: int
    dlq: int
    failed: int
    duration_seconds: float | None = None
    created_at: datetime | None = None
    # Live counters: BatchRun.* froze at ingest time, but reprocessing (drift
    # approve, retry, onboard) moves rows afterwards. These reflect the rows
    # as they stand now, so badges clear the moment held logs drain.
    live_normalized: int = 0
    live_held: int = 0