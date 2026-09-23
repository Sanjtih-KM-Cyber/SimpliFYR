from datetime import datetime

from pydantic import BaseModel

from app.models import EventStatus


class EventSummary(BaseModel):
    id: int
    event_id: str
    status: EventStatus
    received_at: datetime
    source_id: int | None = None
    source: str | None = None
    raw_hash: str


class EventViews(BaseModel):
    raw: str
    parsed: dict | None = None
    normalized: dict | None = None
    output: dict | None = None


class EventDetail(EventSummary):
    raw_ref: str | None = None
    parsed: dict | None = None
    normalized: dict | None = None
    provenance: dict | None = None
    output: dict | None = None
    views: EventViews


class EventSuggestion(BaseModel):
    input_field: str
    semantic_field: str
    confidence: float
    reason: str = ""


class EventOnboardField(BaseModel):
    input_field: str
    semantic_field: str


class EventOnboardRequest(BaseModel):
    connection_name: str | None = None
    mapping_name: str | None = None
    output_profile_id: int | None = None
    fields: list[EventOnboardField] = []


class EventOnboardResponse(BaseModel):
    event_id: int
    source_id: int
    mapping_id: int
    mapping_version: int
    recipe_id: int
    event_status: str