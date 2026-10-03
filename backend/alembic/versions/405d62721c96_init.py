"""Init

Revision ID: 405d62721c96
Revises: 
Create Date: 2026-07-25 19:58:23.803175

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from models import Base

# revision identifiers, used by Alembic.
revision: str = '405d62721c96'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create all KisanShakti schema tables from models."""
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    """Drop all KisanShakti schema tables."""
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
