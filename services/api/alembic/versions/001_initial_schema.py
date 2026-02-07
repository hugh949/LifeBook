"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-02-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "families",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_table(
        "users",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("family_id", sa.String(36), sa.ForeignKey("families.id"), nullable=False),
        sa.Column("role", sa.String(64), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("email", sa.String(255)),
        sa.Column("preferred_language", sa.String(16)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_table(
        "people",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("family_id", sa.String(36), sa.ForeignKey("families.id"), nullable=False),
        sa.Column("display_name", sa.String(255), nullable=False),
        sa.Column("relationship", sa.String(128)),
        sa.Column("language_names_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_table(
        "assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("family_id", sa.String(36), sa.ForeignKey("families.id"), nullable=False),
        sa.Column("type", sa.String(32), nullable=False),
        sa.Column("blob_url", sa.Text(), nullable=False),
        sa.Column("thumb_url", sa.Text()),
        sa.Column("duration_sec", sa.Float()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text())),
    )
    op.create_table(
        "moments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("family_id", sa.String(36), sa.ForeignKey("families.id"), nullable=False),
        sa.Column("title", sa.String(512)),
        sa.Column("summary", sa.Text()),
        sa.Column("language", sa.String(16)),
        sa.Column("tags_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("time_hint_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("place_hint", sa.String(255)),
        sa.Column("source", sa.String(32), nullable=False),
        sa.Column("trailer_config_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_table(
        "moment_assets",
        sa.Column("moment_id", sa.String(36), sa.ForeignKey("moments.id"), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id"), primary_key=True),
        sa.Column("role", sa.String(32), nullable=False),
    )
    op.create_table(
        "moment_people",
        sa.Column("moment_id", sa.String(36), sa.ForeignKey("moments.id"), primary_key=True),
        sa.Column("person_id", sa.String(36), sa.ForeignKey("people.id"), primary_key=True),
    )
    op.create_table(
        "transcripts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("moment_id", sa.String(36), sa.ForeignKey("moments.id")),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("assets.id")),
        sa.Column("language", sa.String(16)),
        sa.Column("text", sa.Text()),
        sa.Column("text_en", sa.Text()),
        sa.Column("timestamps_json", postgresql.JSONB(astext_type=sa.Text())),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    # Default family for local MVP (no auth)
    op.execute(
        "INSERT INTO families (id, name) VALUES "
        "('00000000-0000-4000-a000-000000000001', 'MVP Family')"
    )


def downgrade() -> None:
    op.drop_table("transcripts")
    op.drop_table("moment_people")
    op.drop_table("moment_assets")
    op.drop_table("moments")
    op.drop_table("assets")
    op.drop_table("people")
    op.drop_table("users")
    op.drop_table("families")
