"""Personal re-architecture: wipe old schema, create per-user schema with auth, shares, comments.

This migration drops all legacy tables and recreates a clean schema keyed on users
(email + password) instead of shared families/participants. Pilot-grade: we wipe
existing data rather than migrating.

Revision ID: 017
Revises: 016
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


# Tables to drop (in FK-safe order). Use IF EXISTS because staging/dev DBs may
# have been created with partial schemas from earlier migrations.
_OLD_TABLES = [
    "narrate_bgm_cache",
    "shared_story_listens",
    "voice_stories",
    "transcripts",
    "moment_people",
    "moment_assets",
    "moments",
    "assets",
    "people",
    "voice_participants",
    "users",
    "families",
]


def upgrade() -> None:
    # 1. Drop legacy schema. Pilot wipe, so we do not try to preserve data.
    for tbl in _OLD_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{tbl}" CASCADE')

    # 2. Accounts (email + password)
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)

    # 3. Per-user voice profile and clone state (1-1 with users)
    op.create_table(
        "user_voice",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("eagle_profile_data", sa.LargeBinary(), nullable=True),
        sa.Column("eagle_pending_pcm", sa.LargeBinary(), nullable=True),
        sa.Column("elevenlabs_voice_id", sa.String(64), nullable=True),
        sa.Column("elevenlabs_voice_consent_at", sa.DateTime(timezone=True), nullable=True),
        # clone lifecycle: none | recording | processing | ready | failed
        sa.Column("clone_status", sa.String(32), nullable=False, server_default="none"),
        sa.Column("clone_error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # 4. Per-user pencil-sketch avatar (1-1 with users)
    op.create_table(
        "user_avatar",
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("original_photo_blob_url", sa.Text(), nullable=True),
        sa.Column("pencil_blob_url", sa.Text(), nullable=True),
        sa.Column("style", sa.String(32), nullable=False, server_default="pencil_sketch"),
        # status: none | pencilizing | ready | failed
        sa.Column("status", sa.String(32), nullable=False, server_default="none"),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    # 5. Assets (user-owned)
    op.create_table(
        "assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),  # audio | photo | avatar_source | avatar_rendered | narration | bgm
        sa.Column("blob_url", sa.Text(), nullable=False),
        sa.Column("thumb_url", sa.Text()),
        sa.Column("duration_sec", sa.Float()),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_assets_owner", "assets", ["owner_user_id"])

    # 6. Conversations (was "moments" with source=older_session). Private by default.
    op.create_table(
        "conversations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(512)),
        sa.Column("summary", sa.Text()),
        sa.Column("tags_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("session_turns_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("audio_asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("language", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_conversations_owner", "conversations", ["owner_user_id"])

    # 7. Transcripts (linked to conversations; one per conversation is typical)
    op.create_table(
        "transcripts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("conversation_id", sa.String(36), sa.ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("language", sa.String(16)),
        sa.Column("text", sa.Text()),
        sa.Column("text_en", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_transcripts_conversation", "transcripts", ["conversation_id"])

    # 8. Stories (confirmed narrative derived from a conversation)
    op.create_table(
        "stories",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_conversation_id", sa.String(36), sa.ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(512)),
        sa.Column("summary", sa.Text()),
        sa.Column("story_text", sa.Text()),
        sa.Column("tags_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("narration_asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("bgm_asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_stories_owner", "stories", ["owner_user_id"])

    # 9. Shares — per-item public tokens with optional 4-digit code
    op.create_table(
        "shares",
        sa.Column("id", sa.String(32), primary_key=True),  # URL-safe token
        sa.Column("owner_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("target_type", sa.String(16), nullable=False),  # conversation | story
        sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("code_hash", sa.String(128), nullable=True),  # sha256(share_id:code) if set
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_shares_owner", "shares", ["owner_user_id"])
    op.create_index("ix_shares_target", "shares", ["target_type", "target_id"])

    # 10. Share comments (anonymous recipient)
    op.create_table(
        "share_comments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("share_id", sa.String(32), sa.ForeignKey("shares.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_name", sa.String(120), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_share_comments_share", "share_comments", ["share_id"])

    # 11. Cache narration BGM per story so we don't regenerate on every playback
    op.create_table(
        "story_bgm_cache",
        sa.Column("story_id", sa.String(36), sa.ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )


def downgrade() -> None:
    # This migration is a hard reset; downgrade is not supported for the pilot wipe.
    # Dropping the new tables so the chain stays reversible if someone really needs it.
    for tbl in [
        "story_bgm_cache",
        "share_comments",
        "shares",
        "stories",
        "transcripts",
        "conversations",
        "assets",
        "user_avatar",
        "user_voice",
        "users",
    ]:
        op.execute(f'DROP TABLE IF EXISTS "{tbl}" CASCADE')
