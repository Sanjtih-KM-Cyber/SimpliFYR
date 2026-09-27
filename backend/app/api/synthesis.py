"""Persistent AI synthesis jobs: analysis that survives navigation.

POST /synthesis starts a drift-analysis job and returns immediately; the
work runs on a background task against its own DB session while the row
tracks queued -> running -> completed/failed with stage + progress. Any
page can poll GET /synthesis/{id} (or list recent jobs) to reconnect —
leaving the Review Queue never kills the operation.

No event loop (tests, scripts) -> the job runs inline before returning;
state is still persisted, so callers observe the same contract.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.audit import log_action
from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.drift import _analyze_and_decide

from app.models import DriftRecord, SynthesisJob
from app.schemas.synthesis import CreateSynthesisJob, SynthesisJobSchema

router = APIRouter(prefix="/synthesis", tags=["synthesis"])

_ACTIVE_STATUSES = ("queued", "running")
_RESOLVED_DRIFT = ("approved", "rejected", "ignored")
# A healthy analysis finishes in minutes (slowest path: 3x LLM timeouts);
# anything older in a non-terminal state belongs to a dead worker.
_STALE_AFTER = timedelta(minutes=30)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _to_schema(job: SynthesisJob, drift_source: str | None) -> SynthesisJobSchema:
    return SynthesisJobSchema(
        id=job.id,
        drift_id=job.drift_id,
        drift_source=drift_source,
        status=job.status,
        stage=job.stage,
        progress=job.progress,
        result_status=job.result_status,
        confidence=job.confidence,
        error=job.error,
        created_at=as_utc(job.created_at),
        updated_at=as_utc(job.updated_at),
    )


def _touch(db: Session, job: SynthesisJob, **fields) -> None:
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = _utcnow()
    db.commit()


def _reap_stale(db: Session) -> None:
    """Fail non-terminal jobs whose worker clearly died (restart-safe reads)."""
    cutoff = _utcnow() - _STALE_AFTER
    stale = (
        db.execute(
            select(SynthesisJob).where(
                SynthesisJob.status.in_(_ACTIVE_STATUSES),
                SynthesisJob.updated_at < cutoff,
            )
        )
        .scalars()
        .all()
    )
    for job in stale:
        _touch(
            db,
            job,
            status="failed",
            stage="interrupted",
            error="Worker interrupted before finishing (process restart?) — start a new synthesis.",
        )


def _run_job_sync(job_id: int) -> None:
    """Execute one job on an independent session (thread-safe entry)."""
    from app.core.database import SessionLocal

    with SessionLocal() as db:
        job = db.get(SynthesisJob, job_id)
        if job is None or job.status not in _ACTIVE_STATUSES:
            return
        try:
            _touch(db, job, status="running", stage="resolving drift", progress=10)
            drift = db.get(DriftRecord, job.drift_id)
            if drift is None:
                raise RuntimeError("Drift record no longer exists")
            if drift.status in _RESOLVED_DRIFT:
                raise RuntimeError(f"Drift already {drift.status} — nothing to synthesize")
            _touch(db, job, stage="analyzing with AI provider", progress=35)
            _analyze_and_decide(db, drift)
            _touch(db, job, stage="recording decision", progress=80)
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
            _touch(
                db,
                job,
                status="completed",
                stage="done",
                progress=100,
                result_status=drift.status,
                confidence=drift.confidence,
            )
        except Exception as exc:  # noqa: BLE001 — job must record, never raise
            db.rollback()
            live = db.get(SynthesisJob, job_id)
            if live is not None:
                _touch(
                    db,
                    live,
                    status="failed",
                    stage="failed",
                    error=str(exc)[:1000],
                )


async def _run_job_async(job_id: int) -> None:
    await asyncio.to_thread(_run_job_sync, job_id)


@router.post("", response_model=SynthesisJobSchema, status_code=201)
async def create_synthesis_job(payload: CreateSynthesisJob, db: Session = Depends(get_db)):
    """Start (or reattach to) a synthesis job for a drift record.

    Idempotent per drift: if an active job already exists it is returned
    as-is so double-clicks and remounts never fork duplicate analyses.
    """
    drift = db.get(DriftRecord, payload.drift_id)
    if drift is None:
        raise HTTPException(status_code=404, detail="Drift record not found")
    if drift.status in _RESOLVED_DRIFT:
        raise HTTPException(status_code=409, detail=f"Drift already {drift.status}")

    existing = db.execute(
        select(SynthesisJob)
        .where(
            SynthesisJob.drift_id == payload.drift_id,
            SynthesisJob.status.in_(_ACTIVE_STATUSES),
        )
        .order_by(SynthesisJob.id.desc())
    ).scalars().first()
    if existing is not None:
        return _to_schema(existing, drift.source)

    job = SynthesisJob(drift_id=payload.drift_id, status="queued", stage="queued", progress=0)
    db.add(job)
    db.commit()
    db.refresh(job)

    try:
        asyncio.get_running_loop().create_task(_run_job_async(job.id))
    except RuntimeError:
        # No event loop (tests, scripts): run inline; state stays truthful.
        _run_job_sync(job.id)
        db.refresh(job)
    return _to_schema(job, drift.source)


@router.get("", response_model=list[SynthesisJobSchema])
def list_synthesis_jobs(limit: int = 50, db: Session = Depends(get_db)):
    """Recent jobs, newest first — the reconnect surface for any page."""
    _reap_stale(db)
    jobs = (
        db.execute(select(SynthesisJob).order_by(SynthesisJob.id.desc()).limit(limit))
        .scalars()
        .all()
    )
    sources = {}
    if jobs:
        drift_ids = {j.drift_id for j in jobs}
        rows = db.execute(
            select(DriftRecord.id, DriftRecord.source).where(DriftRecord.id.in_(drift_ids))
        ).all()
        sources = {row[0]: row[1] for row in rows}
    return [_to_schema(j, sources.get(j.drift_id)) for j in jobs]


@router.get("/{job_id}", response_model=SynthesisJobSchema)
def get_synthesis_job(job_id: int, db: Session = Depends(get_db)):
    _reap_stale(db)
    job = db.get(SynthesisJob, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Synthesis job not found")
    drift = db.get(DriftRecord, job.drift_id)
    return _to_schema(job, drift.source if drift else None)
