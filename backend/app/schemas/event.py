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