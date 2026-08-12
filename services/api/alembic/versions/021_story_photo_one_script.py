"""Story photo + one script per conversation.

Revision ID: 021
Revises: 020
"""
from alembic import op
import sqlalchemy as sa

revision = "021"
down_revision = "020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "stories",
        sa.Column("photo_asset_id", sa.String(length=36), nullable=True),
    )
    op.create_foreign_key(
        "fk_stories_photo_asset_id",
        "stories",
        "assets",
        ["photo_asset_id"],
        ["id"],
        ondelete="SET NULL",
    )

    # Keep newest non-deleted story per source_conversation_id; soft-delete the rest
    op.execute(
        """
        UPDATE stories AS s
        SET deleted_at = NOW()
        WHERE s.deleted_at IS NULL
          AND s.source_conversation_id IS NOT NULL
          AND s.id NOT IN (
            SELECT keep_id FROM (
              SELECT DISTINCT ON (source_conversation_id) id AS keep_id
              FROM stories
              WHERE deleted_at IS NULL
                AND source_conversation_id IS NOT NULL
              ORDER BY source_conversation_id, updated_at DESC NULLS LAST, created_at DESC
            ) AS keepers
          )
        """
    )

    op.create_index(
        "uq_stories_one_script_per_conversation",
        "stories",
        ["source_conversation_id"],
        unique=True,
        postgresql_where=sa.text("deleted_at IS NULL AND source_conversation_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_stories_one_script_per_conversation", table_name="stories")
    op.drop_constraint("fk_stories_photo_asset_id", "stories", type_="foreignkey")
    op.drop_column("stories", "photo_asset_id")
