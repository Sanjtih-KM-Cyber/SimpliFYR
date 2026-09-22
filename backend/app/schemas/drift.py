from datetime import datetime

from pydantic import BaseModel


class FieldSuggestionSchema(BaseModel):
    input_field: str
    semantic_field: str
    confidence: float
    reason: str = ""


class DriftProposalSchema(BaseModel):
    new_field_suggestions: list[FieldSuggestionSchema]
    renamed_from: dict[str, str] = {}
    explanation: str = ""
    confidence: float = 0.0


class DriftSummary(BaseModel):
    id: int
    source: str | None
    status: str
    new_fields: list[str]
    missing_fields: list[str]
    confidence: float
    created_at: datetime


class DriftDetail(DriftSummary):
    mapping_id: int | None = None
    proposal: DriftProposalSchema | None = None
    sample: str | None = None
    event_ids: list[str] = []
    resolved_at: datetime | None = None


class DriftApproveResponse(BaseModel):
    drift_id: int
    new_mapping_id: int
    new_mapping_version: int
    reprocessed_events: int