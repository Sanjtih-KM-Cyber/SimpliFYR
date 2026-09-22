"""add recipes

Revision ID: c5d6e7f8a9b0
Revises: a1b2c3d4e5f6
Create Date: 2026-09-20

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c5d6e7f8a9b0"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recipes",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("source", sa.String(length=255), nullable=False),
        sa.Column("mapping_id", sa.Integer(), nullable=False),
        sa.Column("output_profile_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["mapping_id"], ["mappings.id"]),
        sa.ForeignKeyConstraint(["output_profile_id"], ["output_profiles.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source", name="uq_recipe_source"),
    )
    op.create_index(op.f("ix_recipes_source"), "recipes", ["source"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_recipes_source"), table_name="recipes")
    op.drop_table("recipes")
