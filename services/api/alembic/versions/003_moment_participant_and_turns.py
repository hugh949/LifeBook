"""Add participant_id and session_turns_json to moments (Build 2: auto-save + continuity)

Revision ID: 003
Revises: 002
Create Date: 2026-02-08

"""
from alembic import op
import sqlalchemy as sa  # type: ignore[reportMissingImports]
from sqlalchemy.dialects import postgresql

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "moments",
        sa.Column("participant_id", sa.String(36), sa.ForeignKey("voice_participants.id"), nullable=True),
    )
    op.add_column(
        "moments",
        sa.Column("session_turns_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("moments", "session_turns_json")
    op.drop_column("moments", "participant_id")
