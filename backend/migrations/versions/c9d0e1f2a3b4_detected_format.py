"""stamp + backfill detected_format on events

Revision ID: c9d0e1f2a3b4
Revises: b2c3d4e5f6a7
Create Date: 2026-09-24

The engine detects the payload format on every ingest but never persisted it.
Telemetry Inspection groups quarantine by detected format, so the stamp needs
to live on the row: new column + backfill over existing rows.

Portable across SQLite and Postgres (plain Core SQL + Python-side detect).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c9d0e1f2a3b4"
down_revision: Union[str, None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("detected_format", sa.String(32), nullable=True))
    op.create_index("ix_events_detected_format", "events", ["detected_format"])

    # Backfill: recompute detection from the stored raw payload. Best-effort —
    # rows whose raw cannot be read keep NULL (surfaced as 'unknown').
    try:
        from simplifyr_parsers import detect_format
    except Exception:  # noqa: BLE001
        return
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, raw FROM events WHERE detected_format IS NULL")).all()
    for event_id, raw in rows:
        try:
            fmt = detect_format(raw or "").format.value
        except Exception:  # noqa: BLE001
            continue
        bind.execute(
            sa.text("UPDATE events SET detected_format = :f WHERE id = :i"),
            {"f": fmt, "i": event_id},
        )


def downgrade() -> None:
    op.drop_index("ix_events_detected_format", table_name="events")
    op.drop_column("events", "detected_format")
