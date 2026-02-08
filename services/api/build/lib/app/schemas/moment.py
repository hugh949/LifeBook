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


class MomentPatch(BaseModel):
    add_comment: str | None = None  # append to summary (voice or text comment)
    title: str | None = None
    summary: str | None = None


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

    class Config:
        from_attributes = True
