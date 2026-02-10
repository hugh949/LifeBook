"""Add deleted_at to moments for soft-delete (recall list remove)."""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic (must match 003's revision = "003").
revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "moments",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_column("moments", "deleted_at")
