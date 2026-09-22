from datetime import datetime

from pydantic import BaseModel

from app.schemas.drift import DriftSummary


class ConnectionMapping(BaseModel):
    id: int
    name: str
    version: int
    status: str


class ConnectionProfile(BaseModel):
    id: int
    name: str


class ConnectionSummary(BaseModel):
    """Read-only aggregate view of a Connection.

    A Connection is keyed by the source name (the same key the processing engine
    and stats use) and joins the pieces a user manages with live health stats.
    The output-profile link is null until per-source recipe bindings exist.
    """

    id: str  # connection key == source name
    name: str
    mapping: ConnectionMapping | None = None
    output_profile: ConnectionProfile | None = None
    health: str  # healthy | needs_review | idle
    events_processed: int
    events_by_status: dict[str, int]
    normalization_rate: float
    needs_review: int
    avg_latency_ms: float = 0.0
    last_event_at: datetime | None = None


class ConnectionEvent(BaseModel):
    id: int
    event_id: str
    status: str
    received_at: datetime


class ConnectionDetail(ConnectionSummary):
    created_at: datetime | None = None
    recent_events: list[ConnectionEvent] = []
    drift: list[DriftSummary] = []
