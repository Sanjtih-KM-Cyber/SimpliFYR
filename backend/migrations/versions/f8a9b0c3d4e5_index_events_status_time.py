"""index events by status and received time

Revision ID: f8a9b0c3d4e5
Revises: e7f8a9b0c2d3
Create Date: 2026-09-21

Covers the hot list paths: status filters, retention scans, and
recent-event ordering (all filter/sort on status + received_at).
"""

from typing import Sequence, Union

from alembic import op

revision: str = "f8a9b0c3d4e5"
down_revision: Union[str, None] = "e7f8a9b0c2d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_events_status_received_at", "events", ["status", "received_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_events_status_received_at", table_name="events")
