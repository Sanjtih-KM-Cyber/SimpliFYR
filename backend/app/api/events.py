from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.engine import ProcessingEngine
from app.core.environment import get_environment
from app.core.raw_store import get_raw_store
from app.core.security import require_auth, require_write
from app.models import Event, EventStatus
from app.schemas.event import EventDetail, EventSummary, EventViews

router = APIRouter(prefix="/events", tags=["events"], dependencies=[Depends(require_auth)])


def _to_summary(event: Event) -> EventSummary:
    return EventSummary(
        id=event.id,
        event_id=event.event_id,
        status=event.status,
        received_at=event.received_at,
        source_id=event.source_id,
        source=event.source,
        raw_hash=event.raw_hash,
    )


def _load_raw(event: Event) -> str:
    if event.raw_ref:
        try:
            return get_raw_store().load(event.raw_ref)
        except FileNotFoundError:
            pass
    return event.raw


@router.get("", response_model=list[EventSummary])
def list_events(
    status: EventStatus | None = None,
    source_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    stmt = select(Event).where(Event.environment == environment).order_by(Event.id.desc())
    if status is not None:
        stmt = stmt.where(Event.status == status)
    if source_id is not None:
        stmt = stmt.where(Event.source_id == source_id)
    events = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    return [_to_summary(e) for e in events]


@router.get("/{event_id}", response_model=EventDetail)
def get_event(event_id: int, db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    raw = _load_raw(event)
    return EventDetail(
        **_to_summary(event).model_dump(),
        raw_ref=event.raw_ref,
        parsed=event.parsed,
        normalized=event.normalized,
        provenance=event.provenance,
        output=event.output,
        views=EventViews(
            raw=raw,
            parsed=event.parsed,
            normalized=event.normalized,
            output=event.output,
        ),
    )


@router.get("/{event_id}/raw", response_class=PlainTextResponse)
def get_event_raw(event_id: int, db: Session = Depends(get_db)):
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return _load_raw(event)


_RETRYABLE = (EventStatus.DLQ, EventStatus.QUARANTINED)


@router.post("/{event_id}/retry", response_model=EventDetail, dependencies=[Depends(require_write)])
def retry_event(event_id: int, db: Session = Depends(get_db)):
    """Re-run a dead-lettered or quarantined event through the engine.

    DLQ = malformed input (retry only helps if parsers changed); quarantine =
    unknown/drifted structure (retry after approving new knowledge). Events
    already normalized/output are rejected with 409.
    """
    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status not in _RETRYABLE:
        raise HTTPException(
            status_code=409, detail=f"Only dlq/quarantined events can be retried (status={event.status})"
        )
    ProcessingEngine(db).reprocess(event)
    raw = _load_raw(event)
    return EventDetail(
        **_to_summary(event).model_dump(),
        raw_ref=event.raw_ref,
        parsed=event.parsed,
        normalized=event.normalized,
        provenance=event.provenance,
        output=event.output,
        views=EventViews(
            raw=raw,
            parsed=event.parsed,
            normalized=event.normalized,
            output=event.output,
        ),
    )
