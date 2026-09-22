"""Environment scoping for knowledge tables (§60).

Event rows carry a free-form `environment` string, but knowledge
(Mapping/Recipe/DriftRecord) is keyed by source *name* with no environment FK.
These helpers resolve "which source names belong to this environment" through
the env-scoped Source catalog (Phase 1), so list endpoints can filter knowledge
without a schema migration. Rows with a NULL source are global templates and
stay visible everywhere.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Source


def environment_row_id(db: Session, environment: str) -> int | None:
    """Environment id for a header value, without creating anything."""
    from app.models import Environment

    wanted = (environment or "default").strip() or "default"
    row = db.execute(
        select(Environment).where(func.lower(Environment.name) == wanted.lower())
    ).scalars().first()
    return row.id if row is not None else None


def source_names_in_env(db: Session, environment: str) -> set[str]:
    """Source names registered in this environment's catalog."""
    env_id = environment_row_id(db, environment)
    if env_id is None:
        return set()
    rows = db.execute(select(Source.name).where(Source.environment_id == env_id)).scalars().all()
    return set(rows)
