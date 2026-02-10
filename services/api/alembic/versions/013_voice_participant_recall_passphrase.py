"""Add recall_passphrase to voice_participants for voice unlock of Recall lists."""
from alembic import op

revision = "013"
down_revision = "012"
branch_labels = None
depends_on = None


def upgrade():
    # Idempotent: safe if column was already added (e.g. manually or previous run)
    op.execute(
        "ALTER TABLE voice_participants ADD COLUMN IF NOT EXISTS recall_passphrase VARCHAR(512)"
    )


def downgrade():
    op.execute("ALTER TABLE voice_participants DROP COLUMN IF EXISTS recall_passphrase")
