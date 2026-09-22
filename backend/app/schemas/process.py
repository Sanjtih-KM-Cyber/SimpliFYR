from pydantic import BaseModel


class BatchItemResult(BaseModel):
    index: int
    status: str
    detected_format: str


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