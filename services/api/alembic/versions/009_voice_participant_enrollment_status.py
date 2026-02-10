"""Add enrollment_status to voice_participants for Voice ID (only identify when Enrolled)."""
from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "voice_participants",
        sa.Column("enrollment_status", sa.String(32), nullable=True),
    )


def downgrade():
    op.drop_column("voice_participants", "enrollment_status")
