import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Integer, Float, ForeignKey, DateTime
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
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)


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
