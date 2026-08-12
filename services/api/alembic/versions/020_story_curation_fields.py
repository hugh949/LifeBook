"""Add per-script curation fields: bgm_track and narration_tone.

Revision ID: 020
Revises: 019
"""
from alembic import op
import sqlalchemy as sa

revision = "020"
down_revision = "019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("stories", sa.Column("bgm_track", sa.String(length=32), nullable=True))
    op.add_column("stories", sa.Column("narration_tone", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("stories", "narration_tone")
    op.drop_column("stories", "bgm_track")
