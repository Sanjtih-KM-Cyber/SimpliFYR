from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.ai.base import AIDriftProposal, FieldSuggestion
from app.core.audit import log_action
from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.drift import _analyze_and_decide, apply_corrections, apply_drift, reprocess_quarantined
from app.core.environment import get_environment

from app.models import Approval, ApprovalStatus, DriftRecord, Mapping as MappingModel
from app.schemas.drift import (
    DriftApproveResponse,
    DriftDetail,
    DriftProposalSchema,
    DriftSummary,
)

router = APIRouter(prefix="/drift", tags=["drift"])

_OPEN_STATUSES = ("detected", "analyzed", "review")


class FieldCorrection(BaseModel):
    input_field: str
    semantic_field: str


class CorrectPayload(BaseModel):
    fields: list[FieldCorrection]


def _to_summary(d: DriftRecord) -> DriftSummary:
    return DriftSummary(
        id=d.id,
        source=d.source,
        status=d.status,
        new_fields=d.new_fields,
        missing_fields=d.missing_fields,
        confidence=d.confidence,
        created_at=as_utc(d.created_at),
    )


def _sanitize_stored_proposal(data: object) -> dict | None:
    """Tolerate legacy/malformed stored proposals (history must always render).

    Keeps every salvageable suggestion; drops off-shape entries (e.g. a
    model-written list value inside renamed_from). Returns None only when
    the stored value is not a proposal object at all.
    """
    if not isinstance(data, dict):
        return None
    suggestions = []
    for entry in data.get("new_field_suggestions", []) or []:
        if not isinstance(entry, dict):
            continue
        input_field = entry.get("input_field")
        if not isinstance(input_field, str) or not input_field:
            continue
        semantic = entry.get("semantic_field", "")
        try:
            confidence = float(entry.get("confidence", 0.0))
        except (TypeError, ValueError):
            confidence = 0.0
        reason = entry.get("reason", "")
        suggestions.append(
            {
                "input_field": input_field,
                "semantic_field": semantic if isinstance(semantic, str) else "",
                "confidence": confidence,
                "reason": reason if isinstance(reason, str) else "",
            }
        )
    renamed = data.get("renamed_from", {}) or {}
    renamed_clean = (
        {k: v for k, v in renamed.items() if isinstance(k, str) and isinstance(v, str)}
        if isinstance(renamed, dict)
        else {}
    )
    explanation = data.get("explanation", "")
    try:
        overall = float(data.get("confidence", 0.0))
    except (TypeError, ValueError):
        overall = 0.0
    return {
        "new_field_suggestions": suggestions,
        "renamed_from": renamed_clean,
        "explanation": explanation if isinstance(explanation, str) else "",
        "confidence": overall,
    }


def _to_detail(d: DriftRecord) -> DriftDetail:
    detail = DriftDetail(**_to_summary(d).model_dump())
    detail.mapping_id = d.mapping_id
    detail.sample = d.sample
    detail.event_ids = d.event_ids
    detail.resolved_at = as_utc(d.resolved_at)
    if d.proposal:
        sanitized = _sanitize_stored_proposal(d.proposal)
        if sanitized is not None:
            try:
                detail.proposal = DriftProposalSchema(**sanitized)
            except ValidationError:
                detail.proposal = None
    return detail


def _proposal_to_dict(p: AIDriftProposal) -> dict:
    return {
        "new_field_suggestions": [
            {
                "input_field": s.input_field,
                "semantic_field": s.semantic_field,
                "confidence": s.confidence,
                "reason": s.reason,
            }
            for s in p.new_field_suggestions
        ],
        "renamed_from": p.renamed_from,
        "explanation": p.explanation,
        "confidence": p.confidence,
    }


def _dict_to_proposal(data: dict) -> AIDriftProposal:
    return AIDriftProposal(
        new_field_suggestions=[
            FieldSuggestion(
                input_field=s["input_field"],
                semantic_field=s["semantic_field"],
                confidence=s.get("confidence", 0.0),
                reason=s.get("reason", ""),
            )
            for s in data.get("new_field_suggestions", [])
        ],
        renamed_from=data.get("renamed_from", {}),
        explanation=data.get("explanation", ""),
        confidence=data.get("confidence", 0.0),
    )


def _record_approval(db: Session, drift_id: int, status: ApprovalStatus, comment: str) -> None:
    db.add(Approval(entity_type="drift", entity_id=drift_id, status=status, actor="system", comment=comment))


def _get_drift(db: Session, drift_id: int) -> DriftRecord:
    drift = db.get(DriftRecord, drift_id)
    if drift is None:
        raise HTTPException(status_code=404, detail="Drift record not found")
    return drift


def _known_semantics(db: Session, drift: DriftRecord) -> dict[str, str]:
    mapping = db.get(MappingModel, drift.mapping_id) if drift.mapping_id else None
    if mapping is None:
        return {}
    return {f.input_field: f.semantic_field for f in mapping.fields}


@router.get("", response_model=list[DriftSummary])
def list_drift(
    status: str | None = None,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Drift records for this environment (scoped via the Source catalog).

    Sourceless records (no attributable tenant) stay visible everywhere.
    """
    from app.core.scoping import source_names_in_env

    stmt = select(DriftRecord).order_by(DriftRecord.id.desc())
    if status:
        stmt = stmt.where(DriftRecord.status == status)
    names = source_names_in_env(db, environment)
    if names:
        stmt = stmt.where(DriftRecord.source.is_(None) | DriftRecord.source.in_(names))
    else:
        stmt = stmt.where(DriftRecord.source.is_(None))
    return [_to_summary(d) for d in db.execute(stmt).scalars().all()]


@router.get("/{drift_id}", response_model=DriftDetail)
def get_drift(drift_id: int, db: Session = Depends(get_db)):
    return _to_detail(_get_drift(db, drift_id))


@router.post("/{drift_id}/analyze", response_model=DriftDetail)
def analyze_drift(drift_id: int, db: Session = Depends(get_db)):
    drift = _get_drift(db, drift_id)
    if drift.status in ("approved", "rejected", "ignored"):
        raise HTTPException(status_code=409, detail=f"Drift already {drift.status}")

    _analyze_and_decide(db, drift)
    db.commit()
    log_action(
        db,
        action="analyze",
        entity_type="drift",
        entity_id=drift.id,
        after={"confidence": drift.confidence, "status": drift.status},
    )
    db.commit()
    db.refresh(drift)
    return _to_detail(drift)


@router.post("/{drift_id}/approve", response_model=DriftApproveResponse)
def approve_drift(drift_id: int, db: Session = Depends(get_db)):
    drift = _get_drift(db, drift_id)
    if drift.status == "rejected":
        raise HTTPException(status_code=409, detail="Drift already rejected")

    if not drift.proposal:
        # No prior analysis -> run the intelligence layer first.
        from app.core.ai.provider import analyze_drift_safe

        proposal = analyze_drift_safe(
            source=drift.source,
            new_fields=set(drift.new_fields),
            missing_fields=set(drift.missing_fields),
            known_semantics=_known_semantics(db, drift),
            sample=drift.sample,
        )
        drift.proposal = _proposal_to_dict(proposal)
        drift.confidence = proposal.confidence

    proposal = _dict_to_proposal(drift.proposal)
    try:
        new_mapping = apply_drift(db, drift, proposal)
    except ValueError:
        # Baseline mapping was deleted after this drift was recorded. The
        # record is preserved as history; it can still be dismissed.
        raise HTTPException(
            status_code=409,
            detail=(
                "Baseline mapping no longer exists (it was deleted). "
                "Dismiss this drift item (reject or ignore), or onboard a new mapping for the source."
            ),
        )
    reprocessed = reprocess_quarantined(db, drift.source)

    drift.status = "approved"
    drift.resolved_at = datetime.now(timezone.utc)
    db.commit()
    _record_approval(db, drift.id, ApprovalStatus.APPROVED, f"approve -> mapping v{new_mapping.version}")
    from app.core.training import fields_dict, suggestion_dicts

    log_action(
        db,
        action="approve",
        entity_type="drift",
        entity_id=drift.id,
        before={"proposed": suggestion_dicts(proposal.new_field_suggestions)},
        after={
            "new_mapping_id": new_mapping.id,
            "new_mapping_version": new_mapping.version,
            "reprocessed_events": reprocessed,
            "final": fields_dict(new_mapping),
        },
    )
    db.commit()

    return DriftApproveResponse(
        drift_id=drift.id,
        new_mapping_id=new_mapping.id,
        new_mapping_version=new_mapping.version,
        reprocessed_events=reprocessed,
    )


@router.post("/{drift_id}/reject", response_model=DriftDetail)
def reject_drift(drift_id: int, db: Session = Depends(get_db)):
    drift = _get_drift(db, drift_id)
    if drift.status in ("approved", "ignored"):
        raise HTTPException(status_code=409, detail=f"Drift already {drift.status}")
    drift.status = "rejected"
    drift.resolved_at = datetime.now(timezone.utc)
    db.commit()
    _record_approval(db, drift.id, ApprovalStatus.REJECTED, "rejected by operator")
    log_action(
        db, action="reject", entity_type="drift", entity_id=drift.id, after={"status": "rejected"}
    )
    db.commit()
    db.refresh(drift)
    return _to_detail(drift)


@router.post(
    "/{drift_id}/correct", response_model=DriftApproveResponse
)
def correct_drift(drift_id: int, payload: CorrectPayload, db: Session = Depends(get_db)):
    """Human correction: teach the system the right interpretation.

    The corrected assignments become a new published mapping version (customer
    knowledge); quarantined events are reprocessed with the correction applied.
    """
    drift = _get_drift(db, drift_id)
    if drift.status in ("approved", "rejected", "ignored"):
        raise HTTPException(status_code=409, detail=f"Drift already {drift.status}")

    fields = [f for f in payload.fields if f.semantic_field.strip()]
    if not fields:
        raise HTTPException(status_code=422, detail="Provide at least one corrected field")

    corrections = [
        FieldSuggestion(
            input_field=f.input_field,
            semantic_field=f.semantic_field,
            confidence=1.0,
            reason="human correction",
        )
        for f in fields
    ]
    try:
        new_mapping = apply_corrections(db, drift, corrections)
    except ValueError:
        # Baseline mapping was deleted after this drift was recorded. The
        # record is preserved as history; it can still be dismissed.
        raise HTTPException(
            status_code=409,
            detail=(
                "Baseline mapping no longer exists (it was deleted). "
                "Dismiss this drift item (reject or ignore), or onboard a new mapping for the source."
            ),
        )
    reprocessed = reprocess_quarantined(db, drift.source)

    # Capture the AI proposal BEFORE the backfill below (training honesty:
    # `before` must be what the model said, not the human correction).
    from app.core.training import fields_dict, suggestion_dicts

    original_proposal = suggestion_dicts((drift.proposal or {}).get("new_field_suggestions", []))
    if not drift.proposal:
        drift.proposal = _proposal_to_dict(
            AIDriftProposal(
                new_field_suggestions=corrections,
                explanation="Human-corrected assignments.",
                confidence=1.0,
            )
        )
    drift.status = "approved"
    drift.resolved_at = datetime.now(timezone.utc)
    db.commit()
    _record_approval(db, drift.id, ApprovalStatus.APPROVED, f"correct -> mapping v{new_mapping.version}")
    log_action(
        db,
        action="correct",
        entity_type="drift",
        entity_id=drift.id,
        before={"proposed": original_proposal},
        after={
            "new_mapping_id": new_mapping.id,
            "new_mapping_version": new_mapping.version,
            "reprocessed_events": reprocessed,
            "fields": {f.input_field: f.semantic_field for f in fields},
            "final": fields_dict(new_mapping),
        },
    )
    db.commit()

    return DriftApproveResponse(
        drift_id=drift.id,
        new_mapping_id=new_mapping.id,
        new_mapping_version=new_mapping.version,
        reprocessed_events=reprocessed,
    )


@router.post("/{drift_id}/ignore", response_model=DriftDetail)
def ignore_drift(drift_id: int, db: Session = Depends(get_db)):
    """Ignore a drift: no mapping change, the record is resolved as noise."""
    drift = _get_drift(db, drift_id)
    if drift.status in ("approved", "rejected", "ignored"):
        raise HTTPException(status_code=409, detail=f"Drift already {drift.status}")
    drift.status = "ignored"
    drift.resolved_at = datetime.now(timezone.utc)
    db.commit()
    _record_approval(db, drift.id, ApprovalStatus.REJECTED, "ignored as noise")
    log_action(
        db, action="ignore", entity_type="drift", entity_id=drift.id, after={"status": "ignored"}
    )
    db.commit()
    db.refresh(drift)
    return _to_detail(drift)