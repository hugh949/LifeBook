"""Add narrate_bgm_cache table for synthetic narration BGM per moment."""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "narrate_bgm_cache",
        sa.Column("moment_id", sa.String(36), sa.ForeignKey("moments.id"), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade():
    op.drop_table("narrate_bgm_cache")
