from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Environment, Source, SourceVersion

DEFAULT_VERSION = "v1"


def resolve_environment(db: Session, name: str | None) -> Environment:
    """Resolve an environment by name (case-insensitive), creating it if missing.

    Event envelopes carry a free-form environment string (default "default")
    while the catalog stores Environment rows (seeded "Default"). Matching
    case-insensitively keeps both sides pointing at the same row.
    """
    wanted = (name or "default").strip() or "default"
    existing = db.execute(
        select(Environment).where(func.lower(Environment.name) == wanted.lower())
    ).scalars().first()
    if existing is not None:
        return existing
    env = Environment(name=wanted, description=f"Auto-created for '{wanted}'")
    db.add(env)
    db.flush()
    return env


def ensure_source_version(db: Session, source: Source, version: str = DEFAULT_VERSION) -> SourceVersion:
    """Ensure a version row exists for a source (idempotent)."""
    existing = db.execute(
        select(SourceVersion).where(
            SourceVersion.source_id == source.id, SourceVersion.version == version
        )
    ).scalars().first()
    if existing is not None:
        return existing
    row = SourceVersion(source_id=source.id, version=version, active=True)
    db.add(row)
    db.flush()
    return row


def get_or_create_source(
    db: Session,
    name: str,
    environment: str | None,
    cache: dict | None = None,
) -> Source:
    """Resolve a source by name within an environment, auto-creating it.

    Incoming events only carry a free-form source string. Instead of passing
    it through as an opaque label, the engine registers a real Source (+ v1
    version) so `Event.source_id` is always populated and knowledge
    (mappings/recipes/drift) can later join on identity instead of strings.

    `cache` (a caller-owned dict) memoizes (name, environment) -> Source so
    high-volume loops skip re-querying an identity that cannot change
    mid-stream. Sources are never deleted by the hot path, so the memo is
    safe for the owner's lifetime (e.g. one batch request).
    """
    cleaned = (name or "").strip()
    if not cleaned:
        raise ValueError("Source name is required")
    key = (cleaned, (environment or "default").strip() or "default")
    if cache is not None and key in cache:
        return cache[key]
    env = resolve_environment(db, environment)
    existing = db.execute(
        select(Source).where(Source.name == cleaned, Source.environment_id == env.id)
    ).scalars().first()
    if existing is not None:
        ensure_source_version(db, existing)
        if cache is not None:
            cache[key] = existing
        return existing
    source = Source(name=cleaned, environment_id=env.id)
    db.add(source)
    db.flush()
    ensure_source_version(db, source)
    if cache is not None:
        cache[key] = source
    return source
