from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.datetimes import as_utc
from app.core.environment import get_environment
from app.core.security import require_auth, require_write
from app.models import DriftRecord, Event, Mapping, Recipe
from app.schemas.connection import (
    ConnectionDetail,
    ConnectionEvent,
    ConnectionMapping,
    ConnectionProfile,
    ConnectionSummary,
)
from app.schemas.drift import DriftSummary

router = APIRouter(
    prefix="/connections", tags=["connections"], dependencies=[Depends(require_auth)]
)

# Drift record statuses that mean "a human still needs to look at this".
_OPEN_DRIFT_STATUSES = ("detected", "analyzed", "review")


def _latest_mapping_by_name(rows: list[Mapping]) -> dict[str, Mapping]:
    """Reduce mapping rows (ordered by id asc) to the newest per source name."""
    latest: dict[str, Mapping] = {}
    for m in rows:
        if m.source:
            latest[m.source] = m
    return latest


def _build_summary(
    name: str,
    mapping: Mapping | None,
    by_status: dict[str, int],
    open_drift: int,
    last_event_at,
    recipe: Recipe | None = None,
    avg_latency_ms: float = 0.0,
) -> ConnectionSummary:
    processed = sum(by_status.values())
    normalized = by_status.get("normalized", 0) + by_status.get("output", 0)
    rate = round(normalized / processed, 4) if processed else 0.0
    needs_review = by_status.get("quarantined", 0) + open_drift
    if processed == 0:
        health = "idle"
    elif needs_review > 0:
        health = "needs_review"
    else:
        health = "healthy"
    return ConnectionSummary(
        id=name,
        name=name,
        mapping=(
            ConnectionMapping(
                id=mapping.id,
                name=mapping.name,
                version=mapping.version,
                status=str(mapping.status),
            )
            if mapping
            else None
        ),
        output_profile=(
            ConnectionProfile(id=recipe.output_profile.id, name=recipe.output_profile.name)
            if recipe is not None and recipe.output_profile is not None
            else None
        ),
        health=health,
        events_processed=processed,
        events_by_status=by_status,
        normalization_rate=rate,
        needs_review=needs_review,
        open_drift=open_drift,
        avg_latency_ms=avg_latency_ms,
        last_event_at=as_utc(last_event_at),
    )


@router.get("", response_model=list[ConnectionSummary])
def list_connections(
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Aggregate every Connection: source + active mapping + health stats.

    A Connection exists if it has a mapping or has events in this environment.
    Knowledge lookups are scoped to sources registered in this environment so
    tenants never see each other's mappings/drift.
    """
    from app.core.scoping import source_names_in_env

    catalog_names = source_names_in_env(db, environment)
    event_names = {
        name
        for (name,) in db.execute(
            select(Event.source)
            .where(Event.environment == environment, Event.source.isnot(None))
            .distinct()
        ).all()
    }
    if catalog_names or event_names:
        mapping_names = {
            name
            for (name,) in db.execute(
                select(Mapping.source).where(
                    Mapping.source.isnot(None),
                    Mapping.source.in_(catalog_names | event_names),
                )
            ).all()
        }
    else:
        mapping_names = set()
    names = sorted(mapping_names | event_names)
    if not names:
        return []

    mappings = db.execute(
        select(Mapping).where(Mapping.source.in_(names)).order_by(Mapping.id)
    ).scalars().all()
    latest = _latest_mapping_by_name(list(mappings))

    recipe_rows = db.execute(
        select(Recipe).where(Recipe.source.in_(names))
    ).scalars().all()
    recipes = {r.source: r for r in recipe_rows}

    status_rows = db.execute(
        select(Event.source, Event.status, func.count(Event.id))
        .where(Event.environment == environment, Event.source.in_(names))
        .group_by(Event.source, Event.status)
    ).all()
    last_rows = db.execute(
        select(Event.source, func.max(Event.received_at))
        .where(Event.environment == environment, Event.source.in_(names))
        .group_by(Event.source)
    ).all()
    drift_rows = db.execute(
        select(DriftRecord.source, func.count(DriftRecord.id))
        .where(DriftRecord.source.in_(names), DriftRecord.status.in_(_OPEN_DRIFT_STATUSES))
        .group_by(DriftRecord.source)
    ).all()
    latency_rows = db.execute(
        select(Event.source, func.avg(Event.processing_ms))
        .where(Event.environment == environment, Event.source.in_(names))
        .group_by(Event.source)
    ).all()

    events_by_status: dict[str, dict[str, int]] = {}
    for source, status, count in status_rows:
        events_by_status.setdefault(source, {})[str(status)] = count
    last_event = dict(last_rows)
    open_drift = dict(drift_rows)
    avg_latency = {s: round(float(v), 3) if v is not None else 0.0 for s, v in latency_rows}

    connections = [
        _build_summary(
            name,
            latest.get(name),
            events_by_status.get(name, {}),
            open_drift.get(name, 0),
            last_event.get(name),
            recipes.get(name),
            avg_latency.get(name, 0.0),
        )
        for name in names
    ]
    # Connections needing attention surface first, then by activity.
    connections.sort(
        key=lambda c: (c.health == "idle", -c.needs_review, -c.events_processed, c.name)
    )
    return connections


@router.get("/{source_name}", response_model=ConnectionDetail)
def get_connection(
    source_name: str,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    mapping = db.execute(
        select(Mapping)
        .where(Mapping.source == source_name)
        .order_by(Mapping.id.desc())
    ).scalars().first()

    stmt = (
        select(Event)
        .where(Event.environment == environment, Event.source == source_name)
        .order_by(Event.id.desc())
    )
    recent = db.execute(stmt.limit(10)).scalars().all()
    if mapping is None and not recent:
        raise HTTPException(status_code=404, detail="Connection not found")

    totals = db.execute(
        select(Event.status, func.count(Event.id))
        .where(Event.environment == environment, Event.source == source_name)
        .group_by(Event.status)
    ).all()
    first_event_at = db.execute(
        select(func.min(Event.received_at)).where(
            Event.environment == environment, Event.source == source_name
        )
    ).scalar()
    open_drift = db.execute(
        select(DriftRecord)
        .where(
            DriftRecord.source == source_name,
            DriftRecord.status.in_(_OPEN_DRIFT_STATUSES),
        )
        .order_by(DriftRecord.id.desc())
    ).scalars().all()
    recipe = db.execute(
        select(Recipe).where(Recipe.source == source_name).order_by(Recipe.id.desc())
    ).scalars().first()
    avg_latency = db.execute(
        select(func.avg(Event.processing_ms)).where(
            Event.environment == environment, Event.source == source_name
        )
    ).scalar()

    summary = _build_summary(
        source_name,
        mapping,
        {str(s): c for s, c in totals},
        len(open_drift),
        None,
        recipe,
        round(float(avg_latency), 3) if avg_latency is not None else 0.0,
    )
    created_at = mapping.created_at if mapping else None
    if first_event_at and (created_at is None or first_event_at < created_at):
        created_at = first_event_at

    return ConnectionDetail(
        **summary.model_dump(),
        created_at=as_utc(created_at),
        recent_events=[
            ConnectionEvent(
                id=e.id, event_id=e.event_id, status=str(e.status), received_at=as_utc(e.received_at)
            )
            for e in recent
        ],
        drift=[
            DriftSummary(
                id=d.id,
                source=d.source,
                status=d.status,
                new_fields=d.new_fields or [],
                missing_fields=d.missing_fields or [],
                confidence=d.confidence,
                created_at=as_utc(d.created_at),
            )
            for d in open_drift
        ],
    )


@router.delete("/{source_name}", status_code=204, dependencies=[Depends(require_write)])
def delete_connection(
    source_name: str,
    environment: str = Depends(get_environment),
    db: Session = Depends(get_db),
):
    """Remove a vendor wholesale: events (+raw files), mappings, recipe,
    drift records, and catalog rows. The connection disappears from the
    Integration Hub; the action is audited."""
    from app.core.audit import log_action
    from app.core.raw_store import get_raw_store
    from app.core.sources import resolve_environment
    from app.models import Mapping as MappingModel, Source

    env_id = resolve_environment(db, environment).id

    names = (
        db.execute(
            select(Source).where(Source.name == source_name, Source.environment_id == env_id)
        )
        .scalars()
        .all()
    )
    has_events = (
        db.execute(
            select(Event.id).where(Event.environment == environment, Event.source == source_name).limit(1)
        ).first()
        is not None
    )
    has_mappings = (
        db.execute(select(MappingModel.id).where(MappingModel.source == source_name).limit(1)).first()
        is not None
    )
    if not names and not has_events and not has_mappings:
        raise HTTPException(status_code=404, detail="Connection not found")

    counts: dict[str, int] = {"events": 0, "mappings": 0, "drift": 0, "recipes": 0}
    store = get_raw_store()
    for event in db.execute(
        select(Event).where(Event.environment == environment, Event.source == source_name)
    ).scalars().all():
        if event.raw_ref:
            try:
                store.delete(event.raw_ref)
            except Exception:  # noqa: BLE001
                pass
        db.delete(event)
        counts["events"] += 1
    for recipe in db.execute(select(Recipe).where(Recipe.source == source_name)).scalars().all():
        db.delete(recipe)
        counts["recipes"] += 1
    for drift in db.execute(select(DriftRecord).where(DriftRecord.source == source_name)).scalars().all():
        db.delete(drift)
        counts["drift"] += 1
    for mapping in db.execute(select(MappingModel).where(MappingModel.source == source_name)).scalars().all():
        db.delete(mapping)  # fields cascade via delete-orphan
        counts["mappings"] += 1
    for source in names:
        db.delete(source)  # versions cascade via delete-orphan
    db.commit()
    log_action(
        db,
        action="delete",
        entity_type="connection",
        entity_id=0,
        before={"source": source_name, **counts},
    )
    db.commit()
    return None
