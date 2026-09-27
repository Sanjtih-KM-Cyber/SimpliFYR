"""semantic field registry

Revision ID: e8f9a0b1c2d3
Revises: d4e5f6a7b8c9
Create Date: 2026-09-26

The shared semantic vocabulary as data instead of code: seeded with the
built-in catalog, extended at runtime by human-approved custom values so
pickers, suggestions, and future model training learn them. Existing
mappings are untouched — custom values were always stored verbatim.
Portable across SQLite and Postgres.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e8f9a0b1c2d3"
down_revision: Union[str, None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "semantic_fields",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("data_type", sa.String(length=64), nullable=False, server_default="string"),
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("is_custom", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name", name="uq_semantic_field_name"),
    )
    op.create_index(op.f("ix_semantic_fields_name"), "semantic_fields", ["name"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_semantic_fields_name"), table_name="semantic_fields")
    op.drop_table("semantic_fields")
