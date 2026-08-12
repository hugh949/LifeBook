"""SQLAlchemy ORM models for the personal-rearchitecture schema (see migration 017+).

Identity is per-user (email + password). Everything owned by a user is private
by default; sharing is opt-in via the ``shares`` table with a required password
hash and soft revoke.
"""
import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Float, ForeignKey, DateTime, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase


ID_TYPE = String(36)
TOKEN_TYPE = String(32)


class Base(DeclarativeBase):
    pass


def uuid7_str() -> str:
    return str(uuid.uuid4())


class User(Base):
    """Personal account. All owned content FKs back to `User.id`."""

    __tablename__ = "users"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    email = Column(String(255), nullable=False, unique=True)
    password_hash = Column(String(255), nullable=False)
    display_name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class UserVoice(Base):
    """Per-user voice identity + narration clone state (1-1 with User)."""

    __tablename__ = "user_voice"
    user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    # Picovoice Eagle serialized profile (optional in-session personalization signal)
    eagle_profile_data = Column(LargeBinary, nullable=True)
    eagle_pending_pcm = Column(LargeBinary, nullable=True)
    # ElevenLabs voice id for narration cloning
    elevenlabs_voice_id = Column(String(64), nullable=True)
    elevenlabs_voice_consent_at = Column(DateTime(timezone=True), nullable=True)
    # Clone lifecycle exposed to the UI: none | recording | processing | ready | failed
    clone_status = Column(String(32), nullable=False, default="none")
    clone_error = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class UserAvatar(Base):
    """Pencil-sketch avatar per user (1-1)."""

    __tablename__ = "user_avatar"
    user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    original_photo_blob_url = Column(Text, nullable=True)
    pencil_blob_url = Column(Text, nullable=True)
    style = Column(String(32), nullable=False, default="pencil_sketch")
    # Pipeline state: none | pencilizing | ready | failed
    status = Column(String(32), nullable=False, default="none")
    error = Column(Text, nullable=True)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class Asset(Base):
    """Blob-backed asset (audio, photo, narration, bgm). Owner-scoped."""

    __tablename__ = "assets"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    owner_user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(32), nullable=False)  # audio | photo | avatar_source | avatar_rendered | narration | bgm
    blob_url = Column(Text, nullable=False)
    thumb_url = Column(Text)
    duration_sec = Column(Float)
    metadata_json = Column(JSONB)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Conversation(Base):
    """A recorded voice-agent session (owned by the user)."""

    __tablename__ = "conversations"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    owner_user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String(512))
    summary = Column(Text)
    tags_json = Column(JSONB)
    session_turns_json = Column(JSONB)  # [{ role, content }]
    audio_asset_id = Column(ID_TYPE, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    language = Column(String(16))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class Transcript(Base):
    """Full transcript for a conversation (search + fallback narration text)."""

    __tablename__ = "transcripts"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    conversation_id = Column(ID_TYPE, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False)
    language = Column(String(16))
    text = Column(Text)
    text_en = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Story(Base):
    """Professional story script derived from a conversation (editable; then curated)."""

    __tablename__ = "stories"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    owner_user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    source_conversation_id = Column(
        ID_TYPE, ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True
    )
    title = Column(String(512))
    summary = Column(Text)
    story_text = Column(Text)
    tags_json = Column(JSONB)
    narration_asset_id = Column(ID_TYPE, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    bgm_asset_id = Column(ID_TYPE, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    # Curator choices (music mood + speaking style for listen-back)
    bgm_track = Column(String(32), nullable=True)  # none | neutral | warm | reflective | nostalgic
    narration_tone = Column(String(64), nullable=True)  # warm | gentle | clear | lively | …
    # Optional single photo for Curate / share (one per script)
    photo_asset_id = Column(ID_TYPE, ForeignKey("assets.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)


class Share(Base):
    """Public share token for a conversation or a story."""

    __tablename__ = "shares"
    id = Column(TOKEN_TYPE, primary_key=True)  # URL-safe token, generated in code
    owner_user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    target_type = Column(String(16), nullable=False)  # conversation | story
    target_id = Column(ID_TYPE, nullable=False)
    code_hash = Column(String(128), nullable=True)  # sha256(id:password); required for new shares
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    revoked_at = Column(DateTime(timezone=True), nullable=True)


class ShareComment(Base):
    """Anonymous comment left by a share recipient."""

    __tablename__ = "share_comments"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    share_id = Column(TOKEN_TYPE, ForeignKey("shares.id", ondelete="CASCADE"), nullable=False)
    recipient_name = Column(String(120), nullable=False)
    text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class StoryBgmCache(Base):
    """Cache AI-picked BGM per story so we don't regenerate on every playback."""

    __tablename__ = "story_bgm_cache"
    story_id = Column(ID_TYPE, ForeignKey("stories.id", ondelete="CASCADE"), primary_key=True)
    asset_id = Column(ID_TYPE, ForeignKey("assets.id", ondelete="CASCADE"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class UserPreferences(Base):
    """Chief-of-Staff preference / correction memory (1-1 with User)."""

    __tablename__ = "user_preferences"
    user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    prefs_json = Column(JSONB, nullable=False, default=dict)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


class PasswordResetToken(Base):
    """One-time token for forgotten-password reset (hashed at rest)."""

    __tablename__ = "password_reset_tokens"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    user_id = Column(ID_TYPE, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash = Column(String(128), nullable=False, unique=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)

