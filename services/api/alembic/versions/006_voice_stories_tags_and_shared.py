"""Add tags_json and shared_moment_id to voice_stories."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "voice_stories",
        sa.Column("tags_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.add_column(
        "voice_stories",
        sa.Column("shared_moment_id", sa.String(36), sa.ForeignKey("moments.id"), nullable=True),
    )


def downgrade():
    op.drop_column("voice_stories", "shared_moment_id")
    op.drop_column("voice_stories", "tags_json")
