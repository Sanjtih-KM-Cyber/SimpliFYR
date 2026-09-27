"""batch runs + event batch linkage

Revision ID: d4e5f6a7b8c9
Revises: c9d0e1f2a3b4
Create Date: 2026-09-26

A set of logs parsed at one time (trial run, file upload, paste) gets a
single identity so it can be reviewed, filtered, and approved as one unit.
`events.batch_id` is nullable: pre-existing rows and single ingests stay
unbatched. Portable across SQLite and Postgres.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "batch_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("environment", sa.String(length=64), nullable=False, server_default="default"),
        sa.Column("source", sa.String(length=255), nullable=True),
        sa.Column("total", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("normalized", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("output", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("quarantined", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("dlq", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("duration_seconds", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_batch_runs_environment"), "batch_runs", ["environment"], unique=False)
    op.create_index(op.f("ix_batch_runs_source"), "batch_runs", ["source"], unique=False)
    # Batch mode (copy-and-move): plain ALTER of constraints is unsupported
    # on SQLite, and batch mode is a no-op passthrough on Postgres.
    with op.batch_alter_table("events") as batch_op:
        batch_op.add_column(sa.Column("batch_id", sa.Integer(), nullable=True))
        batch_op.create_index(op.f("ix_events_batch_id"), ["batch_id"], unique=False)
        batch_op.create_foreign_key("fk_events_batch_id", "batch_runs", ["batch_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("events") as batch_op:
        batch_op.drop_constraint("fk_events_batch_id", type_="foreignkey")
        batch_op.drop_index(op.f("ix_events_batch_id"))
        batch_op.drop_column("batch_id")
    op.drop_index(op.f("ix_batch_runs_source"), table_name="batch_runs")
    op.drop_index(op.f("ix_batch_runs_environment"), table_name="batch_runs")
    op.drop_table("batch_runs")
