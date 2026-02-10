"""voice_participants table (Build 1: participant identity)

Revision ID: 002
Revises: 001
Create Date: 2026-02-08

"""
from alembic import op
import sqlalchemy as sa  # type: ignore[reportMissingImports]

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None

DEFAULT_FAMILY_ID = "00000000-0000-4000-a000-000000000001"


def upgrade() -> None:
    op.create_table(
        "voice_participants",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("family_id", sa.String(36), sa.ForeignKey("families.id"), nullable=False),
        sa.Column("label", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute(
        "INSERT INTO voice_participants (id, family_id, label) VALUES "
        "('10000000-0000-4000-a000-000000000001', '" + DEFAULT_FAMILY_ID + "', 'Older adult')"
    )


def downgrade() -> None:
    op.drop_table("voice_participants")
