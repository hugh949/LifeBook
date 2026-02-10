"""Rename participant label 'Older adult' to 'New User'."""
from alembic import op

revision = "012"
down_revision = "011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "UPDATE voice_participants SET label = 'New User' WHERE label = 'Older adult'"
    )


def downgrade():
    op.execute(
        "UPDATE voice_participants SET label = 'Older adult' WHERE label = 'New User'"
    )
