"""per-connection event sequence (each index starts at 1)

Revision ID: a3b4c5d6e7f8
Revises: f1a2b3c4d5e6
Create Date: 2026-09-28

Adds events.source_seq: 1, 2, 3... scoped to (environment, source), assigned
at ingest time. Backfills existing rows by id order per connection; sourceless
events keep NULL. Portable SQLite/Postgres.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3b4c5d6e7f8"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("source_seq", sa.Integer(), nullable=True))
    op.execute(
        sa.text(
            "UPDATE events SET source_seq = ("
            "SELECT COUNT(*) FROM events e2 "
            "WHERE e2.environment = events.environment "
            "AND COALESCE(e2.source, '') = COALESCE(events.source, '') "
            "AND e2.id <= events.id"
            ") WHERE events.source IS NOT NULL"
        )
    )
    op.create_index(
        op.f("ix_events_env_source_seq"),
        "events",
        ["environment", "source", "source_seq"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_events_env_source_seq"), table_name="events")
    op.drop_column("events", "source_seq")
