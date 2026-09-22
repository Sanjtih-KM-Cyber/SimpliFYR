"""backfill event source_id from source strings

Revision ID: e7f8a9b0c2d3
Revises: d6e7f8a9b0c1
Create Date: 2026-09-21

Data-only migration: the engine now registers every source string as a real
Source (+ v1 SourceVersion) and populates Event.source_id. Pre-existing events
ingested before that change have a source label but a NULL FK — link them.

Portable across SQLite and Postgres (plain Core SQL, no RETURNING).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e7f8a9b0c2d3"
down_revision: Union[str, None] = "d6e7f8a9b0c1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _scalar(bind, sql, params=None):
    return bind.execute(sa.text(sql), params or {}).scalar()


def upgrade() -> None:
    bind = op.get_bind()

    env_id = _scalar(bind, "SELECT id FROM environments ORDER BY id LIMIT 1")
    if env_id is None:
        bind.execute(
            sa.text(
                "INSERT INTO environments (name, description, created_at) "
                "VALUES ('Default', 'Default environment', CURRENT_TIMESTAMP)"
            )
        )
        env_id = _scalar(bind, "SELECT id FROM environments ORDER BY id LIMIT 1")

    pairs = bind.execute(
        sa.text(
            "SELECT DISTINCT source, environment FROM events "
            "WHERE source IS NOT NULL AND source <> '' AND source_id IS NULL"
        )
    ).all()

    for name, env_name in pairs:
        target_env = (
            _scalar(
                bind,
                "SELECT id FROM environments WHERE lower(name) = lower(:n)",
                {"n": env_name or "default"},
            )
            or env_id
        )
        source_id = _scalar(
            bind,
            "SELECT id FROM sources WHERE name = :n AND environment_id = :e "
            "ORDER BY id LIMIT 1",
            {"n": name, "e": target_env},
        )
        if source_id is None:
            bind.execute(
                sa.text(
                    "INSERT INTO sources (environment_id, name, status, created_at) "
                    "VALUES (:e, :n, 'active', CURRENT_TIMESTAMP)"
                ),
                {"e": target_env, "n": name},
            )
            source_id = _scalar(
                bind,
                "SELECT id FROM sources WHERE name = :n AND environment_id = :e "
                "ORDER BY id DESC LIMIT 1",
                {"n": name, "e": target_env},
            )
        version_id = _scalar(
            bind,
            "SELECT id FROM source_versions WHERE source_id = :s AND version = 'v1'",
            {"s": source_id},
        )
        if version_id is None:
            bind.execute(
                sa.text(
                    "INSERT INTO source_versions (source_id, version, active, created_at) "
                    "VALUES (:s, 'v1', 1, CURRENT_TIMESTAMP)"
                ),
                {"s": source_id},
            )
        bind.execute(
            sa.text(
                "UPDATE events SET source_id = :s WHERE source = :n "
                "AND source_id IS NULL"
            ),
            {"s": source_id, "n": name},
        )


def downgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE events SET source_id = NULL"))
