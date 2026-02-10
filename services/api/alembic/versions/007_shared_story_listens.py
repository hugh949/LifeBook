"""Add shared_story_listens table for 'new stories you haven't heard' (Build 7)."""
from alembic import op
import sqlalchemy as sa

revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "shared_story_listens",
        sa.Column("participant_id", sa.String(36), sa.ForeignKey("voice_participants.id"), primary_key=True),
        sa.Column("moment_id", sa.String(36), sa.ForeignKey("moments.id"), primary_key=True),
        sa.Column("listened_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("shared_story_listens")
