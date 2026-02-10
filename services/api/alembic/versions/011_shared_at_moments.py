"""Add shared_at to moments (private vs shared with family)."""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "moments",
        sa.Column("shared_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Backfill: existing moments are treated as shared (current bank behavior)
    op.execute(
        "UPDATE moments SET shared_at = updated_at WHERE shared_at IS NULL"
    )


def downgrade():
    op.drop_column("moments", "shared_at")
