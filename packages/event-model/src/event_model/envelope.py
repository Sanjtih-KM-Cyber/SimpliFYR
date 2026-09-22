from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from uuid import uuid4


@dataclass
class IngestionSource:
    """Describes how and where an event was received."""

    type: str
    address: str | None = None


@dataclass
class Envelope:
    """The internal transport representation wrapping every incoming event."""

    event_id: str
    received_at: str
    ingestion_source: IngestionSource
    raw_payload: str
    content_type: str = "text/plain"
    metadata: dict = field(default_factory=dict)


def new_envelope(
    raw_payload: str,
    ingestion_type: str = "file",
    address: str | None = None,
    content_type: str = "text/plain",
    metadata: dict | None = None,
) -> Envelope:
    """Create a Common Event Envelope for an incoming raw payload."""
    received_at = datetime.now(timezone.utc).isoformat()
    return Envelope(
        event_id=str(uuid4()),
        received_at=received_at,
        ingestion_source=IngestionSource(type=ingestion_type, address=address),
        raw_payload=raw_payload,
        content_type=content_type,
        metadata=dict(metadata or {}),
    )