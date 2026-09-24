"""full-text search support on event raw payloads

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f7
Create Date: 2026-09-24

Postgres: enables pg_trgm and adds a GIN trigram index on events.raw for
fast similarity search (typo-tolerant hunting, not just LIKE).
SQLite (dev default): DDL is skipped entirely — the API falls back to a
LIKE scan, so fresh and existing SQLite databases migrate cleanly.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, None] = "a1b2c3d4e5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _is_postgres() -> bool:
    return op.get_bind().dialect.name == "postgresql"


def upgrade() -> None:
    if not _is_postgres():
        return
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        "ix_events_raw_trgm",
        "events",
        ["raw"],
        postgresql_using="gin",
        postgresql_ops={"raw": "gin_trgm_ops"},
    )


def downgrade() -> None:
    if not _is_postgres():
        return
    op.drop_index("ix_events_raw_trgm", table_name="events")
