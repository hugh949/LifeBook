"""Add voice_stories table (Build 5: private stories list; shared = memory bank)."""
from alembic import op
import sqlalchemy as sa


revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "voice_stories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("family_id", sa.String(36), sa.ForeignKey("families.id"), nullable=False),
        sa.Column("participant_id", sa.String(36), sa.ForeignKey("voice_participants.id"), nullable=False),
        sa.Column("source_moment_id", sa.String(36), sa.ForeignKey("moments.id"), nullable=True),
        sa.Column("title", sa.String(512), nullable=True),
        sa.Column("summary", sa.Text(), nullable=True),
        sa.Column("draft_text", sa.Text(), nullable=True),
        sa.Column("final_audio_asset_id", sa.String(36), sa.ForeignKey("assets.id"), nullable=True),
        sa.Column("status", sa.String(32), nullable=False),  # draft | final | shared
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade():
    op.drop_table("voice_stories")
