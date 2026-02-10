"""Add Eagle Voice ID profile and pending PCM to voice_participants."""
from alembic import op
import sqlalchemy as sa

revision = "010"
down_revision = "009"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "voice_participants",
        sa.Column("eagle_profile_data", sa.LargeBinary(), nullable=True),
    )
    op.add_column(
        "voice_participants",
        sa.Column("eagle_pending_pcm", sa.LargeBinary(), nullable=True),
    )


def downgrade():
    op.drop_column("voice_participants", "eagle_pending_pcm")
    op.drop_column("voice_participants", "eagle_profile_data")
