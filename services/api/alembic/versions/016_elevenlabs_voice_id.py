"""Add elevenlabs_voice_id and elevenlabs_voice_consent_at to voice_participants for narration voice cloning."""
from alembic import op

revision = "016"
down_revision = "015"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE voice_participants ADD COLUMN IF NOT EXISTS elevenlabs_voice_id VARCHAR(64)"
    )
    op.execute(
        "ALTER TABLE voice_participants ADD COLUMN IF NOT EXISTS elevenlabs_voice_consent_at TIMESTAMP WITH TIME ZONE"
    )


def downgrade():
    op.execute("ALTER TABLE voice_participants DROP COLUMN IF EXISTS elevenlabs_voice_id")
    op.execute("ALTER TABLE voice_participants DROP COLUMN IF EXISTS elevenlabs_voice_consent_at")
