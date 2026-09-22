from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models import DriftRecord, Event, Mapping, OutputProfile

router = APIRouter(tags=["system"])


@router.get("/metrics", response_class=PlainTextResponse, include_in_schema=False)
def metrics(db: Session = Depends(get_db)):
    """Prometheus text-format metrics for observability."""
    lines = [
        "# HELP simplifyr_events_total Total events ingested.",
        "# TYPE simplifyr_events_total counter",
    ]
    total = db.execute(select(func.count(Event.id))).scalar() or 0
    lines.append(f"simplifyr_events_total {total}")

    lines.append("# HELP simplifyr_events_by_status Events by pipeline stage.")
    lines.append("# TYPE simplifyr_events_by_status gauge")
    for status, count in db.execute(
        select(Event.status, func.count(Event.id)).group_by(Event.status)
    ).all():
        lines.append(f'simplifyr_events_by_status{{status="{status}"}} {count}')

    lines.append("# HELP simplifyr_drift_total Drift records.")
    lines.append("# TYPE simplifyr_drift_total gauge")
    drift_total = db.execute(select(func.count(DriftRecord.id))).scalar() or 0
    lines.append(f"simplifyr_drift_total {drift_total}")

    lines.append("# HELP simplifyr_mappings_total Mapping configurations.")
    lines.append("# TYPE simplifyr_mappings_total gauge")
    lines.append(f"simplifyr_mappings_total {db.execute(select(func.count(Mapping.id))).scalar() or 0}")

    lines.append("# HELP simplifyr_profiles_total Output profiles.")
    lines.append("# TYPE simplifyr_profiles_total gauge")
    lines.append(f"simplifyr_profiles_total {db.execute(select(func.count(OutputProfile.id))).scalar() or 0}")

    from app.core.pipeline import queue_depth, queue_dropped_total

    lines.append("# HELP simplifyr_queue_depth Buffered events awaiting processing.")
    lines.append("# TYPE simplifyr_queue_depth gauge")
    lines.append(f"simplifyr_queue_depth {queue_depth()}")

    lines.append("# HELP simplifyr_queue_dropped_total Events shed on a full buffer.")
    lines.append("# TYPE simplifyr_queue_dropped_total counter")
    lines.append(f"simplifyr_queue_dropped_total {queue_dropped_total()}")

    return "\n".join(lines) + "\n"