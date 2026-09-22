"""store AI proposal on onboardings (training flywheel)

Revision ID: a1b2c3d4e5f7
Revises: f8a9b0c3d4e5
Create Date: 2026-09-23

Adds onboardings.proposal (JSON): the AI suggestion list captured at analyze
time, so approve can audit before (model) vs after (human) without an extra
model call.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a1b2c3d4e5f7"
down_revision: Union[str, None] = "f8a9b0c3d4e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("onboardings", sa.Column("proposal", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("onboardings", "proposal")
