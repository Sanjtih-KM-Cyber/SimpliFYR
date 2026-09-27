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