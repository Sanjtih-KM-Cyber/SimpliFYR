from datetime import datetime

from pydantic import BaseModel


class CreateSynthesisJob(BaseModel):
    drift_id: int


class SynthesisJobSchema(BaseModel):
    id: int
    drift_id: int
    drift_source: str | None = None
    status: str
    stage: str | None = None
    progress: int = 0
    result_status: str | None = None
    confidence: float | None = None
    error: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
