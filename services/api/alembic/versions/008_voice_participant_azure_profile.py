"""Add azure_speaker_profile_id to voice_participants for Voice ID (Azure Speaker Recognition)."""
from alembic import op
import sqlalchemy as sa

revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "voice_participants",
        sa.Column("azure_speaker_profile_id", sa.String(36), nullable=True),
    )


def downgrade():
    op.drop_column("voice_participants", "azure_speaker_profile_id")
