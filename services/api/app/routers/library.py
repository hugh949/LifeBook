"""Library router: the private list of a user's conversations and stories, plus
per-item details and soft-delete. Also creates stories from the realtime agent's
``confirm_story`` tool (``POST /stories/confirm``).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.azure_storage import signed_read_url
from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.ai_recall import generate_story_title


logger = logging.getLogger(__name__)
router = APIRouter(tags=["library"])


# -- Schemas ------------------------------------------------------------------


class LibraryItem(BaseModel):
    id: str
    kind: Literal["conversation", "story"]
    title: str | None
    summary: str | None
    tags: list[str]
    created_at: str
    has_audio: bool = False
    has_share: bool = False


class ConversationDetail(BaseModel):
    id: str
    kind: Literal["conversation"] = "conversation"
    title: str | None
    summary: str | None
    tags: list[str]
    created_at: str
    turns: list[dict]
    transcript: str | None
    audio_url: str | None


class StoryDetail(BaseModel):
    id: str
    kind: Literal["story"] = "story"
    title: str | None
    summary: str | None
    story_text: str | None
    tags: list[str]
    created_at: str
    source_conversation_id: str | None
    audio_url: str | None


class CommentOut(BaseModel):
    id: str
    share_id: str
    recipient_name: str
    text: str
    created_at: str


class ConfirmStoryBody(BaseModel):
    story_text: str
    source_conversation_id: str | None = None


class StorySummaryOut(BaseModel):
    id: str
    title: str | None
    summary: str | None
    created_at: str


# -- Helpers ------------------------------------------------------------------


def _tags(v) -> list[str]:
    if not isinstance(v, list):
        return []
    return [str(t).strip() for t in v if str(t).strip()][:10]


def _signed(url: str | None) -> str | None:
    if not url:
        return None
    key = (settings.azure_storage_account_key or "").strip()
    if not key:
        return url
    return signed_read_url(url, key, getattr(settings, "read_sas_ttl_minutes", 60))


def _audio_url_for_conversation(db: Session, conv: models.Conversation) -> str | None:
    if not conv.audio_asset_id:
        return None
    asset = db.query(models.Asset).filter(models.Asset.id == conv.audio_asset_id).first()
    if not asset:
        return None
    return _signed(asset.blob_url)


def _audio_url_for_story(db: Session, story: models.Story) -> str | None:
    if not story.narration_asset_id:
        return None
    asset = db.query(models.Asset).filter(models.Asset.id == story.narration_asset_id).first()
    if not asset:
        return None
    return _signed(asset.blob_url)


def _share_exists(db: Session, owner_id: str, target_type: str, target_id: str) -> bool:
    q = (
        db.query(models.Share.id)
        .filter(
            models.Share.owner_user_id == owner_id,
            models.Share.target_type == target_type,
            models.Share.target_id == target_id,
            models.Share.revoked_at.is_(None),
        )
        .first()
    )
    return bool(q)


# -- Endpoints ----------------------------------------------------------------


@router.get("/library", response_model=list[LibraryItem])
def list_library(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    owner_id = str(current_user.id)
    convos = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.owner_user_id == owner_id,
            models.Conversation.deleted_at.is_(None),
        )
        .order_by(models.Conversation.created_at.desc())
        .all()
    )
    stories = (
        db.query(models.Story)
        .filter(
            models.Story.owner_user_id == owner_id,
            models.Story.deleted_at.is_(None),
        )
        .order_by(models.Story.created_at.desc())
        .all()
    )

    out: list[LibraryItem] = []
    for c in convos:
        out.append(
            LibraryItem(
                id=str(c.id),
                kind="conversation",
                title=(c.title or "").strip() or None,
                summary=(c.summary or "").strip() or None,
                tags=_tags(c.tags_json),
                created_at=c.created_at.isoformat() if c.created_at else "",
                has_audio=bool(c.audio_asset_id),
                has_share=_share_exists(db, owner_id, "conversation", str(c.id)),
            )
        )
    for s in stories:
        out.append(
            LibraryItem(
                id=str(s.id),
                kind="story",
                title=(s.title or "").strip() or None,
                summary=(s.summary or "").strip() or None,
                tags=_tags(s.tags_json),
                created_at=s.created_at.isoformat() if s.created_at else "",
                has_audio=bool(s.narration_asset_id),
                has_share=_share_exists(db, owner_id, "story", str(s.id)),
            )
        )
    out.sort(key=lambda it: it.created_at, reverse=True)
    return out


@router.get("/library/conversations/{conversation_id}", response_model=ConversationDetail)
def get_conversation(
    conversation_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.owner_user_id == current_user.id,
            models.Conversation.deleted_at.is_(None),
        )
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    transcript = (
        db.query(models.Transcript)
        .filter(models.Transcript.conversation_id == conv.id)
        .order_by(models.Transcript.created_at.asc())
        .first()
    )
    turns = conv.session_turns_json if isinstance(conv.session_turns_json, list) else []
    return ConversationDetail(
        id=str(conv.id),
        title=(conv.title or "").strip() or None,
        summary=(conv.summary or "").strip() or None,
        tags=_tags(conv.tags_json),
        created_at=conv.created_at.isoformat() if conv.created_at else "",
        turns=[{"role": t.get("role"), "content": t.get("content")} for t in turns if isinstance(t, dict)],
        transcript=((transcript.text_en or transcript.text) if transcript else None),
        audio_url=_audio_url_for_conversation(db, conv),
    )


@router.delete("/library/conversations/{conversation_id}")
def delete_conversation(
    conversation_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    conv = (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.owner_user_id == current_user.id,
            models.Conversation.deleted_at.is_(None),
        )
        .first()
    )
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    conv.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"deleted": True}


@router.get("/library/stories/{story_id}", response_model=StoryDetail)
def get_story(
    story_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    story = (
        db.query(models.Story)
        .filter(
            models.Story.id == story_id,
            models.Story.owner_user_id == current_user.id,
            models.Story.deleted_at.is_(None),
        )
        .first()
    )
    if not story:
        raise HTTPException(status_code=404, detail="Story not found.")
    return StoryDetail(
        id=str(story.id),
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        story_text=(story.story_text or "").strip() or None,
        tags=_tags(story.tags_json),
        created_at=story.created_at.isoformat() if story.created_at else "",
        source_conversation_id=str(story.source_conversation_id) if story.source_conversation_id else None,
        audio_url=_audio_url_for_story(db, story),
    )


@router.delete("/library/stories/{story_id}")
def delete_story(
    story_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    story = (
        db.query(models.Story)
        .filter(
            models.Story.id == story_id,
            models.Story.owner_user_id == current_user.id,
            models.Story.deleted_at.is_(None),
        )
        .first()
    )
    if not story:
        raise HTTPException(status_code=404, detail="Story not found.")
    story.deleted_at = datetime.now(timezone.utc)
    db.commit()
    return {"deleted": True}


@router.get("/library/{kind}/{item_id}/comments", response_model=list[CommentOut])
def list_comments(
    kind: str,
    item_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all comments left by recipients across all share-links for this item."""
    if kind not in ("conversations", "stories"):
        raise HTTPException(status_code=404, detail="Not found.")
    target_type = "conversation" if kind == "conversations" else "story"
    shares = (
        db.query(models.Share.id)
        .filter(
            models.Share.owner_user_id == current_user.id,
            models.Share.target_type == target_type,
            models.Share.target_id == item_id,
        )
        .all()
    )
    share_ids = [s.id for s in shares]
    if not share_ids:
        return []
    rows = (
        db.query(models.ShareComment)
        .filter(models.ShareComment.share_id.in_(share_ids))
        .order_by(models.ShareComment.created_at.desc())
        .all()
    )
    return [
        CommentOut(
            id=str(r.id),
            share_id=str(r.share_id),
            recipient_name=r.recipient_name,
            text=r.text,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.post("/stories/confirm", response_model=StorySummaryOut)
def confirm_story(
    body: ConfirmStoryBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tool-handler for the realtime agent: create a final story owned by the current user."""
    text = (body.story_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Story text is required.")
    source_id = (body.source_conversation_id or "").strip() or None
    source_conv = None
    if source_id:
        source_conv = (
            db.query(models.Conversation)
            .filter(
                models.Conversation.id == source_id,
                models.Conversation.owner_user_id == current_user.id,
            )
            .first()
        )
    tags: list[str] = []
    if source_conv and isinstance(source_conv.tags_json, list):
        tags = _tags(source_conv.tags_json)
    api_key = (settings.openai_api_key or "").strip()
    model = (settings.openai_text_model or "").strip() or "gpt-4o-mini"
    title = generate_story_title(text, api_key, model) if text else None
    if not title:
        title = "Voice story"
    story = models.Story(
        owner_user_id=current_user.id,
        source_conversation_id=source_conv.id if source_conv else None,
        title=title,
        summary=text[:500],
        story_text=text,
        tags_json=tags if tags else None,
    )
    db.add(story)
    db.commit()
    db.refresh(story)
    logger.info("library/stories: confirmed story_id=%s user=%s", story.id, current_user.id)
    return StorySummaryOut(
        id=str(story.id),
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        created_at=story.created_at.isoformat() if story.created_at else "",
    )
