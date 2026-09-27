"""persistent AI synthesis jobs (survive navigation)

Revision ID: f1a2b3c4d5e6
Revises: e8f9a0b1c2d3
Create Date: 2026-09-26

Synthesis (drift analysis) moves off the request lifecycle into a tracked
row (see SynthesisJob): queued -> running -> completed/failed with stage +
progress, so the UI can start a job, leave the page, and reconnect to its
state later. Portable SQLite/Postgres.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e8f9a0b1c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "synthesis_jobs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("drift_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False, server_default="queued"),
        sa.Column("stage", sa.String(length=128), nullable=True),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("result_status", sa.String(length=32), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["drift_id"], ["drift_records.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_synthesis_jobs_drift_id"), "synthesis_jobs", ["drift_id"], unique=False)
    op.create_index(op.f("ix_synthesis_jobs_status"), "synthesis_jobs", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_synthesis_jobs_status"), table_name="synthesis_jobs")
    op.drop_index(op.f("ix_synthesis_jobs_drift_id"), table_name="synthesis_jobs")
    op.drop_table("synthesis_jobs")
