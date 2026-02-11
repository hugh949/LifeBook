"""Add reaction_log to moments: family reactions kept separate from story summary (not narrated)."""
from alembic import op

revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE moments ADD COLUMN IF NOT EXISTS reaction_log TEXT"
    )


def downgrade():
    op.execute("ALTER TABLE moments DROP COLUMN IF EXISTS reaction_log")
