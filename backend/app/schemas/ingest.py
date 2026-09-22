from pydantic import BaseModel, Field

from simplifyr_parsers import Format


class IngestSourceSchema(BaseModel):
    type: str
    address: str | None = None


class EnvelopeSchema(BaseModel):
    event_id: str
    received_at: str
    ingestion_source: IngestSourceSchema
    raw_payload: str
    content_type: str
    metadata: dict = Field(default_factory=dict)


class DetectionSchema(BaseModel):
    format: Format
    confidence: float
    detail: str


class IngestResponse(BaseModel):
    envelope: EnvelopeSchema
    detection: DetectionSchema
    status: str
    parsed: dict | None
    normalized: dict | None = None
    provenance: dict | None = None
    output: dict | None = None
    stored_event_id: int
    duplicate: bool = False