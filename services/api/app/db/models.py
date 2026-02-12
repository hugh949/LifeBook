import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Integer, Float, ForeignKey, DateTime, LargeBinary
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase
import enum

# Match migration 001: id/fk columns are String(36), not PostgreSQL UUID type
ID_TYPE = String(36)


class Base(DeclarativeBase):
    pass


def uuid7_str():
    return str(uuid.uuid4())


class AssetType(str, enum.Enum):
    photo = "photo"
    audio = "audio"


class MomentSource(str, enum.Enum):
    older_session = "older_session"
    family_upload = "family_upload"
    mixed = "mixed"


class Family(Base):
    __tablename__ = "families"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class User(Base):
    __tablename__ = "users"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    family_id = Column(ID_TYPE, ForeignKey("families.id"), nullable=False)
    role = Column(String(64), nullable=False)  # older_adult, family_member, curator
    display_name = Column(String(255), nullable=False)
    email = Column(String(255))
    preferred_language = Column(String(16))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Person(Base):
    __tablename__ = "people"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    family_id = Column(ID_TYPE, ForeignKey("families.id"), nullable=False)
    display_name = Column(String(255), nullable=False)
    relationship = Column(String(128))
    language_names_json = Column(JSONB)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class Asset(Base):
    __tablename__ = "assets"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    family_id = Column(ID_TYPE, ForeignKey("families.id"), nullable=False)
    type = Column(String(32), nullable=False)  # photo | audio
    blob_url = Column(Text, nullable=False)
    thumb_url = Column(Text)
    duration_sec = Column(Float)
    created_by_user_id = Column(ID_TYPE, ForeignKey("users.id"))
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    metadata_json = Column(JSONB)


class Moment(Base):
    __tablename__ = "moments"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    family_id = Column(ID_TYPE, ForeignKey("families.id"), nullable=False)
    title = Column(String(512))
    summary = Column(Text)
    language = Column(String(16))
    tags_json = Column(JSONB)  # ["tag1", "tag2"]
    time_hint_json = Column(JSONB)
    place_hint = Column(String(255))
    source = Column(String(32), nullable=False)  # older_session | family_upload | mixed
    trailer_config_json = Column(JSONB)
    participant_id = Column(ID_TYPE, ForeignKey("voice_participants.id"))  # Build 2: who this session belongs to
    session_turns_json = Column(JSONB)  # Build 2: [{ "role": "user"|"assistant", "content": "..." }, ...]
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime(timezone=True), nullable=True)  # soft-delete for recall list
    shared_at = Column(DateTime(timezone=True), nullable=True)  # NULL = private; set when shared with family
    reaction_log = Column(Text, nullable=True)  # Give Reaction comments (family feedback), separate from summary; not narrated


class MomentAsset(Base):
    __tablename__ = "moment_assets"
    moment_id = Column(ID_TYPE, ForeignKey("moments.id"), primary_key=True)
    asset_id = Column(ID_TYPE, ForeignKey("assets.id"), primary_key=True)
    role = Column(String(32), nullable=False)  # hero, support, voice_note, session_audio


class MomentPerson(Base):
    __tablename__ = "moment_people"
    moment_id = Column(ID_TYPE, ForeignKey("moments.id"), primary_key=True)
    person_id = Column(ID_TYPE, ForeignKey("people.id"), primary_key=True)


class Transcript(Base):
    __tablename__ = "transcripts"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    moment_id = Column(ID_TYPE, ForeignKey("moments.id"))
    asset_id = Column(ID_TYPE, ForeignKey("assets.id"))
    language = Column(String(16))
    text = Column(Text)
    text_en = Column(Text)
    timestamps_json = Column(JSONB)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class VoiceParticipant(Base):
    """Who is speaking in a voice session; used for per-participant history and greeting by name."""
    __tablename__ = "voice_participants"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    family_id = Column(ID_TYPE, ForeignKey("families.id"), nullable=False)
    label = Column(String(255), nullable=False)  # display name, e.g. "Older adult", "Sarah"
    azure_speaker_profile_id = Column(String(36), nullable=True)  # Voice ID: Azure Speaker Recognition profile
    enrollment_status = Column(String(32), nullable=True)  # Enrolled | Enrolling | Training; only Enrolled used for identify
    eagle_profile_data = Column(LargeBinary, nullable=True)  # Voice ID: Picovoice Eagle serialized profile
    eagle_pending_pcm = Column(LargeBinary, nullable=True)  # Voice ID: accumulated PCM until enrollment 100%
    recall_passphrase = Column(String(512), nullable=True)  # Spoken phrase to unlock Recall lists (stored normalized)
    elevenlabs_voice_id = Column(String(64), nullable=True)  # ElevenLabs voice ID for narration (cloned from conversation)
    elevenlabs_voice_consent_at = Column(DateTime(timezone=True), nullable=True)  # When user consented (e.g. button press)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class SharedStoryListen(Base):
    """Build 7: Track when a participant has listened to a shared story (for 'new stories you haven't heard')."""
    __tablename__ = "shared_story_listens"
    participant_id = Column(ID_TYPE, ForeignKey("voice_participants.id"), primary_key=True)
    moment_id = Column(ID_TYPE, ForeignKey("moments.id"), primary_key=True)
    listened_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)


class NarrateBgmCache(Base):
    """Cache of AI-generated narration BGM per moment (unique music per story)."""
    __tablename__ = "narrate_bgm_cache"
    moment_id = Column(ID_TYPE, ForeignKey("moments.id"), primary_key=True)
    asset_id = Column(ID_TYPE, ForeignKey("assets.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)


class VoiceStory(Base):
    """Build 5: Story from voice discussion. draft/final = private (Recall past stories); shared = in memory bank."""
    __tablename__ = "voice_stories"
    id = Column(ID_TYPE, primary_key=True, default=uuid7_str)
    family_id = Column(ID_TYPE, ForeignKey("families.id"), nullable=False)
    participant_id = Column(ID_TYPE, ForeignKey("voice_participants.id"), nullable=False)
    source_moment_id = Column(ID_TYPE, ForeignKey("moments.id"), nullable=True)
    title = Column(String(512), nullable=True)
    summary = Column(Text, nullable=True)
    tags_json = Column(JSONB, nullable=True)  # ["tag1", "tag2"] like recall list
    draft_text = Column(Text, nullable=True)
    final_audio_asset_id = Column(ID_TYPE, ForeignKey("assets.id"), nullable=True)
    status = Column(String(32), nullable=False)  # draft | final | shared
    shared_moment_id = Column(ID_TYPE, ForeignKey("moments.id"), nullable=True)  # set when moved to memory bank
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
