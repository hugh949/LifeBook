from datetime import datetime
from pydantic import BaseModel
from typing import Any


class MomentCreate(BaseModel):
    title: str | None = None
    summary: str | None = None
    language: str | None = None
    tags_json: list[str] | None = None
    source: str = "family_upload"
    asset_ids: list[str] | None = None
    participant_id: str | None = None  # who created (for private-by-default uploads)


class MomentPatch(BaseModel):
    add_comment: str | None = None  # append to reaction_log (family feedback; not narrated)
    title: str | None = None
    summary: str | None = None
    add_voice_comment_asset_id: str | None = None  # link audio asset as voice_note comment


class MomentResponse(BaseModel):
    id: str
    family_id: str
    title: str | None
    summary: str | None
    language: str | None
    tags_json: list | None
    source: str
    created_at: datetime
    updated_at: datetime | None
    shared_at: datetime | None = None
    participant_id: str | None = None

    class Config:
        from_attributes = True
