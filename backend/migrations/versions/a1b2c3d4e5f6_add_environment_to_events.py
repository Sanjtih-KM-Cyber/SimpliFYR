"""add environment to events

Revision ID: a1b2c3d4e5f6
Revises: 222bbb1b7f7f
Create Date: 2026-09-19

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "222bbb1b7f7f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("events", sa.Column("environment", sa.String(length=64), nullable=False, server_default="default"))
    op.create_index(op.f("ix_events_environment"), "events", ["environment"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_events_environment"), table_name="events")
    op.drop_column("events", "environment")