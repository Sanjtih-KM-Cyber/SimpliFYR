from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.engine import ProcessingEngine
from app.core.environment import get_environment
from app.core.raw_store import get_raw_store
from app.core.security import require_auth, require_write
from app.core.config import settings
from app.models import Event, EventStatus
from app.schemas.event import (
    EventDetail,
    EventOnboardRequest,
    EventOnboardResponse,
    EventSuggestion,
    EventSummary,
    EventViews,
)

router = APIRouter(prefix="/events", tags=["events"], dependencies=[Depends(require_auth)])


def _to_summary(event: Event) -> EventSummary:
    return EventSummary(
        id=event.id,
        event_id=event.event_id,
        status=event.status,
        received_at=as_utc(event.received_at),
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
    source: str | None = None,
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
    if source:
        stmt = stmt.where(Event.source == source)
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
    raw = _load_raw(event)
    if len(raw.encode("utf-8")) > settings.max_raw_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Raw payload exceeds {settings.max_raw_bytes} bytes; use export with filters",
        )
    return PlainTextResponse(raw)


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


def _event_field_map(event: Event) -> tuple[dict, str | None]:
    """Parsed field map + source hint for AI suggestions (side-effect-free)."""
    from simplifyr_parsers import detect_format, extract_fields, parse

    raw = _load_raw(event)
    detection = detect_format(raw)
    try:
        parsed = parse(detection.format, raw)
    except Exception:
        parsed = None
    if parsed is None:
        parsed = event.parsed
    if parsed is None:
        return {}, event.source
    try:
        return extract_fields(parsed, detection.format), event.source
    except Exception:
        return {}, event.source


@router.get("/{event_id}/suggest", response_model=list[EventSuggestion])
def suggest_event_mapping(event_id: int, db: Session = Depends(get_db)):
    """AI field suggestions for a quarantined event (reads only, stores nothing)."""
    from app.core.ai.provider import propose_mapping_safe

    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    field_map, source = _event_field_map(event)
    if not field_map:
        raise HTTPException(status_code=422, detail="No mappable fields in this event")
    proposal = propose_mapping_safe(source=source, field_map=field_map, sample=_load_raw(event))
    return [
        EventSuggestion(
            input_field=s.input_field,
            semantic_field=s.semantic_field,
            confidence=s.confidence,
            reason=s.reason,
        )
        for s in proposal.new_field_suggestions
    ]


@router.post("/{event_id}/onboard", response_model=EventOnboardResponse, dependencies=[Depends(require_write)])
def onboard_event(event_id: int, payload: EventOnboardRequest, db: Session = Depends(get_db)):
    """Give a quarantined event a home: create/extend the mapping for its
    connection (existing source = new version, new name = new vendor/source),
    bind the recipe, and reprocess the event through the new knowledge."""
    from app.core.ai.provider import propose_mapping_safe
    from app.core.audit import log_action
    from app.core.publishing import publish_mapping_knowledge
    from app.models import Approval, ApprovalStatus

    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    if event.status not in _RETRYABLE:
        raise HTTPException(
            status_code=409, detail=f"Only dlq/quarantined events can be onboarded (status={event.status})"
        )

    connection_name = (payload.connection_name or event.source or "").strip()
    fields = [(f.input_field, f.semantic_field) for f in payload.fields if f.input_field.strip() and f.semantic_field.strip()]
    if not fields:
        field_map, _ = _event_field_map(event)
        if not field_map:
            raise HTTPException(status_code=422, detail="No mappable fields in this event")
        proposal = propose_mapping_safe(source=connection_name or None, field_map=field_map, sample=_load_raw(event))
        fields = [(s.input_field, s.semantic_field) for s in proposal.new_field_suggestions if s.semantic_field]
    if not fields:
        raise HTTPException(status_code=422, detail="No mappable fields found; provide fields explicitly")

    _source, _version, mapping, recipe = publish_mapping_knowledge(
        db,
        source_name=connection_name,
        fields=fields,
        mapping_name=payload.mapping_name,
        output_profile_id=payload.output_profile_id,
        environment=event.environment,
    )
    # The event now belongs to this connection: adopt its identity BEFORE
    # reprocessing so source_id is never NULL (previously a 500 on sourceless
    # probe events) and the row shows under the right connection afterwards.
    event.source = _source.name
    event.source_id = _source.id
    db.add(
        Approval(entity_type="event", entity_id=event.id, status=ApprovalStatus.APPROVED, actor="system", comment=f"onboarded -> mapping {mapping.name}")
    )
    log_action(
        db,
        action="onboard",
        entity_type="event",
        entity_id=event.id,
        after={"mapping_id": mapping.id, "recipe_id": recipe.id, "source": connection_name},
    )
    db.commit()

    ProcessingEngine(db).reprocess(event)
    db.refresh(event)
    return EventOnboardResponse(
        event_id=event.id,
        source_id=event.source_id,
        mapping_id=mapping.id,
        mapping_version=mapping.version,
        recipe_id=recipe.id,
        event_status=str(event.status),
    )


@router.delete("/{event_id}", status_code=204, dependencies=[Depends(require_write)])
def delete_event(event_id: int, db: Session = Depends(get_db)):
    """Delete an event and its raw file (e.g. junk probes). Audited."""
    from app.core.audit import log_action

    event = db.get(Event, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Event not found")
    before = {"source": event.source, "status": str(event.status)}
    if event.raw_ref:
        try:
            get_raw_store().delete(event.raw_ref)
        except Exception:  # noqa: BLE001
            pass
    db.delete(event)
    db.commit()
    # Audit in a fresh session: the event row (and its session state) is gone.
    from app.core.database import SessionLocal as _SessionLocal

    with _SessionLocal() as adb:
        log_action(adb, action="delete", entity_type="event", entity_id=event_id, before=before)
        adb.commit()
    return None
