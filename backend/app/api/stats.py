from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.database import get_db
from app.core.environment import get_environment
from app.core.security import require_auth
from app.models import DriftRecord, Event, Mapping, OutputProfile
from app.schemas.stats import ConfigResponse, StatsResponse

router = APIRouter(tags=["stats"], dependencies=[Depends(require_auth)])


@router.get("/stats", response_model=StatsResponse)
def get_stats(
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    total_events = db.execute(
        select(func.count(Event.id)).where(Event.environment == environment)
    ).scalar() or 0

    rows = db.execute(
        select(Event.status, func.count(Event.id))
        .where(Event.environment == environment)
        .group_by(Event.status)
    ).all()
    events_by_status = {status: count for status, count in rows}

    cutoff = datetime.now(timezone.utc) - timedelta(seconds=60)
    recent = db.execute(
        select(func.count(Event.id)).where(
            Event.environment == environment, Event.received_at >= cutoff
        )
    ).scalar() or 0
    events_per_second = round(recent / 60.0, 3)

    from app.core.scoping import environment_row_id, source_names_in_env
    from app.models import Source

    names = source_names_in_env(db, environment)
    env_id = environment_row_id(db, environment)

    sources = (
        db.execute(select(func.count(Source.id)).where(Source.environment_id == env_id)).scalar() or 0
        if env_id is not None
        else 0
    )
    if names:
        mappings = (
            db.execute(
                select(func.count(Mapping.id)).where(
                    Mapping.source.is_(None) | Mapping.source.in_(names)
                )
            ).scalar() or 0
        )
    else:
        mappings = db.execute(select(func.count(Mapping.id)).where(Mapping.source.is_(None))).scalar() or 0
    if env_id is not None:
        profiles = (
            db.execute(
                select(func.count(OutputProfile.id)).where(
                    OutputProfile.environment_id.is_(None) | (OutputProfile.environment_id == env_id)
                )
            ).scalar() or 0
        )
    else:
        profiles = db.execute(
            select(func.count(OutputProfile.id)).where(OutputProfile.environment_id.is_(None))
        ).scalar() or 0

    drift_stmt = select(DriftRecord.status, func.count(DriftRecord.id))
    pending_stmt = select(func.count(DriftRecord.id)).where(DriftRecord.status.in_(("detected", "analyzed")))
    if names:
        drift_stmt = drift_stmt.where(DriftRecord.source.is_(None) | DriftRecord.source.in_(names))
        pending_stmt = pending_stmt.where(DriftRecord.source.is_(None) | DriftRecord.source.in_(names))
    else:
        drift_stmt = drift_stmt.where(DriftRecord.source.is_(None))
        pending_stmt = pending_stmt.where(DriftRecord.source.is_(None))
    drift_rows = db.execute(drift_stmt.group_by(DriftRecord.status)).all()
    drift_by_status = {status: count for status, count in drift_rows}
    quarantine_pending = db.execute(pending_stmt).scalar() or 0

    return StatsResponse(
        total_events=total_events,
        events_by_status=events_by_status,
        events_per_second=events_per_second,
        sources=sources,
        mappings=mappings,
        output_profiles=profiles,
        drift_by_status=drift_by_status,
        quarantine_pending=quarantine_pending,
    )


@router.get("/config", response_model=ConfigResponse)
def get_config():
    """Non-secret runtime configuration (never exposes tokens/keys)."""
    return ConfigResponse(
        auth_enabled=security.auth_status(),
        ai_provider=settings.ai_provider,
        ai_auto_apply=settings.ai_auto_apply,
        ai_auto_apply_threshold=settings.ai_auto_apply_threshold,
        ai_review_threshold=settings.ai_review_threshold,
        pipeline_workers=settings.pipeline_workers,
        pipeline_max_queue=settings.pipeline_max_queue,
        retention_days=settings.retention_days,
        raw_retention_days=settings.raw_retention_days,
        normalized_retention_days=settings.normalized_retention_days,
        audit_retention_days=settings.audit_retention_days,
        rate_limit_per_minute=settings.rate_limit_per_minute,
        syslog_enabled=settings.syslog_enabled,
        syslog_udp_host=settings.syslog_udp_host,
        syslog_udp_port=settings.syslog_udp_port,
        syslog_tcp_enabled=settings.syslog_tcp_enabled,
        syslog_tcp_port=settings.syslog_tcp_port,
        file_watch_enabled=settings.file_watch_enabled,
        kafka_ingress_enabled=settings.kafka_ingress_enabled,
        pipeline_backend=settings.pipeline_backend,
        raw_store_backend=settings.raw_store_backend,
        cache_backend=settings.cache_backend,
        delivery_sinks=[s for s in settings.delivery_sinks.split(",") if s.strip()],
    )