from __future__ import annotations

import asyncio
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ai.base import AIDriftProposal, FieldSuggestion
from app.core.config import settings
from app.models import DriftRecord, Event, EventStatus, Mapping as MappingModel
from app.models import MappingField, MappingStatus

# Keys injected by parsers as structural metadata (not user fields). Ignored when
# comparing event structure so they never produce false drift signals.
META_KEYS = {"timestamp", "hostname", "pri", "message", "event_id", "received_at", "id"}

# Event-envelope internals: ingesting an exported event (or any payload shaped
# like one) must not read its wrapper keys as "new log fields".
INTERNAL_KEYS = {
    "normalized",
    "output",
    "parsed",
    "provenance",
    "raw_hash",
    "raw_ref",
    "status",
    "views",
    "source",
    "source_id",
}


def meaningful_fields(field_map: dict) -> set[str]:
    return {k for k in field_map if k not in META_KEYS and k not in INTERNAL_KEYS}


def detect_drift(field_map: dict, mapping: MappingModel) -> tuple[set[str], set[str]] | None:
    """Return (new_fields, missing_fields) when the event structure drifted, else None.

    Only new fields trigger drift (e.g. a renamed field appears); a subset of expected
    fields is treated as normal (optional fields may be absent).
    """
    observed = meaningful_fields(field_map)
    expected = {f.input_field for f in mapping.fields}
    new_fields = observed - expected
    if not new_fields:
        return None
    return new_fields, expected - observed


_OPEN_DRIFT = ("detected", "analyzed", "review")
_MAX_DRIFT_EVENT_IDS = 500


def create_drift(
    db: Session,
    *,
    source: str | None,
    mapping_id: int,
    new_fields: set[str],
    missing_fields: set[str],
    sample: str,
    event_id: str,
) -> DriftRecord:
    """Record drift, merging into an open record with the same field shape.

    A hundred anomalous events carrying the same 2 new parameters become ONE
    item (not a hundred): same source + mapping + new-field set merges,
    accumulating event ids. A different field shape is a different anomaly
    and stays its own item.
    """
    new_set = set(new_fields)
    open_records = (
        db.execute(
            select(DriftRecord).where(
                DriftRecord.source == source,
                DriftRecord.mapping_id == mapping_id,
                DriftRecord.status.in_(_OPEN_DRIFT),
            )
        )
        .scalars()
        .all()
    )
    for candidate in open_records:
        if set(candidate.new_fields or []) == new_set:
            ids = list(candidate.event_ids or [])
            if event_id not in ids:
                ids.append(event_id)
            candidate.event_ids = ids[-_MAX_DRIFT_EVENT_IDS:]
            candidate.sample = sample[:4000]
            db.commit()
            db.refresh(candidate)
            return candidate
    drift = DriftRecord(
        source=source,
        mapping_id=mapping_id,
        status="detected",
        new_fields=sorted(new_fields),
        missing_fields=sorted(missing_fields),
        sample=sample[:4000],
        event_ids=[event_id],
    )
    db.add(drift)
    db.commit()
    db.refresh(drift)
    maybe_schedule_automation(drift.id)
    return drift


def _create_versioned_mapping(
    db: Session,
    baseline: MappingModel,
    suggestions: list[FieldSuggestion],
) -> MappingModel:
    """Publish a new mapping version: baseline fields plus the given assignments."""
    max_version = db.execute(
        select(MappingModel.version).where(MappingModel.source == baseline.source)
    ).scalars().all()
    new_version = (max(max_version) if max_version else 0) + 1

    new_mapping = MappingModel(
        name=f"{baseline.name} v{new_version}",
        source=baseline.source,
        event_family=baseline.event_family,
        status=MappingStatus.PUBLISHED,
        version=new_version,
    )
    applied: set[str] = set()
    for f in baseline.fields:
        if f.input_field in {s.input_field for s in suggestions}:
            continue  # redefined by the given assignment
        new_mapping.fields.append(
            MappingField(
                input_field=f.input_field,
                semantic_field=f.semantic_field,
                transformation=f.transformation,
                confidence=f.confidence,
            )
        )
        applied.add(f.input_field)
    for s in suggestions:
        if not s.semantic_field or s.input_field in applied:
            continue
        new_mapping.fields.append(
            MappingField(
                input_field=s.input_field,
                semantic_field=s.semantic_field,
                confidence=s.confidence,
                transformation=None,
            )
        )
        applied.add(s.input_field)

    db.add(new_mapping)
    db.commit()
    db.refresh(new_mapping)
    if baseline.source:
        from app.core.mapping_cache import invalidate_active_mapping

        invalidate_active_mapping(baseline.source)
    return new_mapping


def _rebind_recipe_to_mapping(db: Session, source: str | None, mapping: MappingModel) -> None:
    """Point the configure-once recipe at a newly published mapping version.

    Without this, ingests and reprocessing keep resolving the stale pre-drift
    mapping through the recipe and the new knowledge never takes effect.
    """
    if not source:
        return
    from app.models import Recipe

    recipe = db.execute(select(Recipe).where(Recipe.source == source)).scalars().first()
    if recipe is not None and recipe.mapping_id != mapping.id:
        recipe.mapping_id = mapping.id
        from app.core.mapping_cache import invalidate_active_mapping

        invalidate_active_mapping(source)


def apply_drift(db: Session, drift: DriftRecord, proposal: AIDriftProposal) -> MappingModel:
    """Publish a new mapping version from an AI proposal and reprocess quarantined events."""
    baseline = db.get(MappingModel, drift.mapping_id)
    if baseline is None:
        raise ValueError("Baseline mapping not found")
    new_mapping = _create_versioned_mapping(db, baseline, proposal.new_field_suggestions)
    _rebind_recipe_to_mapping(db, baseline.source, new_mapping)
    return new_mapping


def apply_corrections(
    db: Session, drift: DriftRecord, corrections: list[FieldSuggestion]
) -> MappingModel:
    """Publish a new mapping version from human-corrected field assignments."""
    baseline = db.get(MappingModel, drift.mapping_id)
    if baseline is None:
        raise ValueError("Baseline mapping not found")
    new_mapping = _create_versioned_mapping(
        db,
        baseline,
        [
            FieldSuggestion(
                input_field=c.input_field,
                semantic_field=c.semantic_field,
                confidence=1.0,
                reason="human correction",
            )
            for c in corrections
        ],
    )
    _rebind_recipe_to_mapping(db, baseline.source, new_mapping)
    return new_mapping


def reprocess_quarantined(db: Session, source: str | None) -> int:
    """Re-run quarantined events for a source through the engine (now with new knowledge)."""
    from app.core.engine import ProcessingEngine

    stmt = select(Event).where(Event.status == EventStatus.QUARANTINED)
    if source:
        stmt = stmt.where(Event.source == source)
    events = db.execute(stmt).scalars().all()

    engine = ProcessingEngine(db)
    count = 0
    for event in events:
        engine.reprocess(event, source=source)
        count += 1
    return count


def _known_semantics(db: Session, drift: DriftRecord) -> dict[str, str]:
    mapping = db.get(MappingModel, drift.mapping_id) if drift.mapping_id else None
    if mapping is None:
        return {}
    return {f.input_field: f.semantic_field for f in mapping.fields}


def _analyze_and_decide(db: Session, drift: DriftRecord) -> str:
    """Analyze drift and act on confidence.

    AI proposes; humans teach. High confidence (and a complete interpretation) ->
    automatically process; medium confidence -> process and flag for review; low
    confidence -> wait for human input. Returns the decision outcome.
    """
    from app.core.ai.provider import analyze_drift_safe

    proposal = analyze_drift_safe(
        source=drift.source,
        new_fields=set(drift.new_fields),
        missing_fields=set(drift.missing_fields),
        known_semantics=_known_semantics(db, drift),
        sample=drift.sample,
    )
    drift.proposal = {
        "new_field_suggestions": [
            {
                "input_field": s.input_field,
                "semantic_field": s.semantic_field,
                "confidence": s.confidence,
                "reason": s.reason,
            }
            for s in proposal.new_field_suggestions
        ],
        "renamed_from": proposal.renamed_from,
        "explanation": proposal.explanation,
        "confidence": proposal.confidence,
    }
    drift.confidence = proposal.confidence

    confident = [s for s in proposal.new_field_suggestions if s.semantic_field]
    complete = bool(proposal.new_field_suggestions) and len(confident) == len(
        proposal.new_field_suggestions
    )

    if settings.ai_auto_apply and complete and proposal.confidence >= settings.ai_auto_apply_threshold:
        new_mapping = apply_drift(db, drift, proposal)
        reprocessed = reprocess_quarantined(db, drift.source)
        drift.status = "approved"
        drift.resolved_at = datetime.now(timezone.utc)
        db.commit()
        from app.core.audit import log_action

        log_action(
            db,
            action="auto_apply",
            entity_type="drift",
            entity_id=drift.id,
            after={
                "new_mapping_id": new_mapping.id,
                "new_mapping_version": new_mapping.version,
                "reprocessed_events": reprocessed,
                "confidence": proposal.confidence,
            },
        )
        db.commit()
        return "auto_applied"

    if proposal.confidence >= settings.ai_review_threshold and confident:
        drift.status = "analyzed"
        db.commit()
        return "flagged"

    drift.status = "review"
    db.commit()
    return "needs_input"


def maybe_schedule_automation(drift_id: int) -> None:
    """Fire-and-forget confidence automation for a newly detected drift record.

    Runs off the hot path: analysis happens in a background thread with its own
    database session, so event processing is never blocked.
    """
    if not settings.ai_auto_apply:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    loop.create_task(asyncio.to_thread(_run_automation_sync, drift_id))


def _run_automation_sync(drift_id: int) -> None:
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        drift = db.get(DriftRecord, drift_id)
        if drift is None or drift.status != "detected":
            return
        _analyze_and_decide(db, drift)
