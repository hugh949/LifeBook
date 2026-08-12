"""Library router: the private list of a user's conversations and stories, plus
per-item details and soft-delete. Also creates stories from the realtime agent's
``confirm_story`` tool (``POST /stories/confirm``).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.azure_storage import signed_read_url
from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.ai_recall import generate_story_title
from app.services.narration import synthesize_narration_mp3, voice_enrollment_snapshot
from app.services.share_bgm_track import pick_share_bgm_track
from app.services.story_curation import (
    BGM_TRACKS,
    NARRATION_TONES,
    bgm_label,
    clear_story_generated_bgm,
    ensure_story_generated_bgm,
    format_curator_status,
    generative_music_available,
    story_bgm_url,
    suggest_curation,
    tone_label,
)
from app.services.story_script import (
    conversation_source_text,
    derive_script_text,
    find_script_for_conversation,
    upsert_script_for_conversation,
)
from app.services.user_preferences import get_or_create_prefs, learn_from_content_job


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
    script_id: str | None = None  # conversation → linked script
    has_photo: bool = False  # story
    source_conversation_id: str | None = None


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
    script_id: str | None = None


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
    bgm_track: str | None = None
    narration_tone: str | None = None
    photo_url: str | None = None
    photo_asset_id: str | None = None
    bgm_url: str | None = None  # unique generative bed when available
    has_unique_bgm: bool = False
    voice_enrolled: bool = False
    voice_label: str | None = None
    voice_hint: str | None = None
    voice_setup_path: str = "/me/voice"


class CommentOut(BaseModel):
    id: str
    share_id: str
    recipient_name: str
    text: str
    created_at: str


class ConfirmStoryBody(BaseModel):
    story_text: str
    source_conversation_id: str | None = None
    story_id: str | None = None  # update existing script in place when refining


class UpdateStoryBody(BaseModel):
    """Patch script text and/or Curate choices (music, speaking tone, photo)."""

    title: str | None = None
    story_text: str | None = None
    bgm_track: str | None = None
    narration_tone: str | None = None
    photo_asset_id: str | None = None  # set to "" or "null" via explicit clear? use Optional with sentinel
    clear_photo: bool = False


class StorySummaryOut(BaseModel):
    id: str
    title: str | None
    summary: str | None
    created_at: str


class PrivatePreviewOut(BaseModel):
    """Curator private listen-back (no share required)."""

    kind: Literal["conversation", "story"]
    id: str
    title: str | None
    summary: str | None
    body_text: str | None
    narration_url: str
    bgm_track: str = "neutral"
    narration_tone: str | None = None
    photo_url: str | None = None
    bgm_url: str | None = None  # unique bed overrides library /bgm/{id}.mp3
    voice_enrolled: bool = False
    voice_label: str | None = None
    voice_hint: str | None = None


class CurateSuggestBody(BaseModel):
    force: bool = False  # re-pick even if already set
    try_generate: bool = True  # kick off unique bed in background when configured


class CurateSuggestOut(BaseModel):
    bgm_track: str
    narration_tone: str
    reason: str
    status_line: str
    applied: bool
    music_source: Literal["library", "generated", "generating", "none"] = "library"
    bgm_url: str | None = None
    generative_available: bool = False
    voice_enrolled: bool = False
    voice_label: str | None = None
    voice_hint: str | None = None
    voice_setup_path: str = "/me/voice"


# BGM_TRACKS / NARRATION_TONES imported from story_curation


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


def _photo_url_for_story(db: Session, story: models.Story) -> str | None:
    pid = getattr(story, "photo_asset_id", None)
    if not pid:
        return None
    asset = db.query(models.Asset).filter(models.Asset.id == pid).first()
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


def _story_detail(db: Session, story: models.Story) -> StoryDetail:
    unique_url = story_bgm_url(db, story)
    voice = voice_enrollment_snapshot(db, str(story.owner_user_id))
    return StoryDetail(
        id=str(story.id),
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        story_text=(story.story_text or "").strip() or None,
        tags=_tags(story.tags_json),
        created_at=story.created_at.isoformat() if story.created_at else "",
        source_conversation_id=str(story.source_conversation_id) if story.source_conversation_id else None,
        audio_url=_audio_url_for_story(db, story),
        bgm_track=(story.bgm_track or "").strip() or None,
        narration_tone=(story.narration_tone or "").strip() or None,
        photo_url=_photo_url_for_story(db, story),
        photo_asset_id=str(story.photo_asset_id) if getattr(story, "photo_asset_id", None) else None,
        bgm_url=unique_url,
        has_unique_bgm=bool(unique_url),
        voice_enrolled=bool(voice.get("enrolled")),
        voice_label=(voice.get("label") or None),
        voice_hint=(voice.get("hint") or None),
        voice_setup_path=str(voice.get("setup_path") or "/me/voice"),
    )


# -- Endpoints ----------------------------------------------------------------


@router.get("/library", response_model=list[LibraryItem])
def list_library(
    filter: Literal["all", "private", "shared"] = Query("all"),
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
    script_by_conv: dict[str, str] = {}
    for s in stories:
        if s.source_conversation_id:
            script_by_conv[str(s.source_conversation_id)] = str(s.id)

    for c in convos:
        # Conversations are vault-only — never list as "shared" for share filter on conv
        has_share = False
        if filter == "shared":
            continue
        out.append(
            LibraryItem(
                id=str(c.id),
                kind="conversation",
                title=(c.title or "").strip() or None,
                summary=(c.summary or "").strip() or None,
                tags=_tags(c.tags_json),
                created_at=c.created_at.isoformat() if c.created_at else "",
                has_audio=bool(c.audio_asset_id),
                has_share=has_share,
                script_id=script_by_conv.get(str(c.id)),
            )
        )
    for s in stories:
        has_share = _share_exists(db, owner_id, "story", str(s.id))
        if filter == "private" and has_share:
            continue
        if filter == "shared" and not has_share:
            continue
        out.append(
            LibraryItem(
                id=str(s.id),
                kind="story",
                title=(s.title or "").strip() or None,
                summary=(s.summary or "").strip() or None,
                tags=_tags(s.tags_json),
                created_at=s.created_at.isoformat() if s.created_at else "",
                has_audio=bool(s.narration_asset_id),
                has_share=has_share,
                has_photo=bool(getattr(s, "photo_asset_id", None)),
                source_conversation_id=str(s.source_conversation_id) if s.source_conversation_id else None,
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
    script = find_script_for_conversation(db, str(current_user.id), str(conv.id))
    return ConversationDetail(
        id=str(conv.id),
        title=(conv.title or "").strip() or None,
        summary=(conv.summary or "").strip() or None,
        tags=_tags(conv.tags_json),
        created_at=conv.created_at.isoformat() if conv.created_at else "",
        turns=[{"role": t.get("role"), "content": t.get("content")} for t in turns if isinstance(t, dict)],
        transcript=((transcript.text_en or transcript.text) if transcript else None),
        audio_url=_audio_url_for_conversation(db, conv),
        script_id=str(script.id) if script else None,
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
    return _story_detail(db, story)


@router.patch("/library/stories/{story_id}", response_model=StoryDetail)
def update_story(
    story_id: str,
    body: UpdateStoryBody,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Update script text and/or Curate fields (music, speaking tone, photo)."""
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

    text_changed = False
    if body.title is not None:
        title = body.title.strip()
        if title:
            story.title = title[:512]
    if body.story_text is not None:
        text = body.story_text.strip()
        if not text:
            raise HTTPException(status_code=400, detail="Script text cannot be empty.")
        story.story_text = text
        story.summary = text[:500]
        text_changed = True
    if body.bgm_track is not None:
        track = body.bgm_track.strip().lower()
        if track and track not in BGM_TRACKS:
            raise HTTPException(status_code=400, detail="Invalid music mood.")
        prev = (story.bgm_track or "").strip().lower() or None
        story.bgm_track = track or None
        if (track or None) != prev:
            # Library mood change replaces any unique generative bed
            clear_story_generated_bgm(db, story)
    if body.narration_tone is not None:
        tone = body.narration_tone.strip().lower()
        if tone and tone not in NARRATION_TONES:
            raise HTTPException(status_code=400, detail="Invalid speaking tone.")
        story.narration_tone = tone or None
    if body.clear_photo:
        story.photo_asset_id = None
    elif body.photo_asset_id is not None:
        pid = body.photo_asset_id.strip()
        if not pid:
            story.photo_asset_id = None
        else:
            asset = (
                db.query(models.Asset)
                .filter(
                    models.Asset.id == pid,
                    models.Asset.owner_user_id == current_user.id,
                    models.Asset.type == "photo",
                )
                .first()
            )
            if not asset:
                raise HTTPException(status_code=400, detail="Photo asset not found.")
            story.photo_asset_id = asset.id

    story.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(story)

    api_key = (settings.openai_api_key or "").strip()
    if text_changed and api_key and story.story_text:
        learn_blob = f"Title: {story.title or ''}\n\n{story.story_text}"
        background_tasks.add_task(
            learn_from_content_job,
            str(current_user.id),
            learn_blob,
            "story",
            api_key,
        )

    return _story_detail(db, story)


@router.post("/library/stories/{story_id}/curate/suggest", response_model=CurateSuggestOut)
def suggest_story_curation(
    story_id: str,
    background_tasks: BackgroundTasks,
    body: CurateSuggestBody | None = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Auto-curate: Curator picks music + tone, persists when unset (or force), optional unique bed."""
    req = body or CurateSuggestBody()

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

    body_text, title, summary = _story_body(story)
    if not body_text:
        raise HTTPException(status_code=400, detail="Script text is empty — finish Script first.")

    saved_bgm = (story.bgm_track or "").strip().lower() or None
    saved_tone = (story.narration_tone or "").strip().lower() or None
    already = bool(saved_bgm and saved_tone and saved_bgm in BGM_TRACKS and saved_tone in NARRATION_TONES)

    applied = False
    if already and not req.force:
        bgm = saved_bgm or "neutral"
        tone = saved_tone or "warm"
        reason = (
            f"Keeping {bgm_label(bgm)} music and a {tone_label(tone)} tone — "
            f"change either by talking with Curator."
        )
    else:
        pick = suggest_curation(
            body_text,
            title,
            summary,
            openai_api_key=settings.openai_api_key,
            model=settings.openai_curator_model,
        )
        bgm = pick["bgm_track"]
        tone = pick["narration_tone"]
        reason = pick["reason"]
        prev_bgm = (story.bgm_track or "").strip().lower()
        prev_tone = (story.narration_tone or "").strip().lower()
        if prev_bgm != bgm or prev_tone != tone:
            clear_story_generated_bgm(db, story)
        story.bgm_track = bgm
        story.narration_tone = tone
        story.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(story)
        applied = True

    unique = story_bgm_url(db, story)
    gen_ok = generative_music_available()
    music_source: Literal["library", "generated", "generating", "none"] = "library"
    if (bgm or "").strip().lower() == "none":
        music_source = "none"
    elif unique:
        music_source = "generated"
    elif req.try_generate and gen_ok and (bgm or "").strip().lower() != "none":
        music_source = "generating"
        background_tasks.add_task(ensure_story_generated_bgm, str(story.id))

    status = format_curator_status(bgm, tone, has_unique_bed=bool(unique))
    voice = voice_enrollment_snapshot(db, str(current_user.id))
    return CurateSuggestOut(
        bgm_track=bgm,
        narration_tone=tone,
        reason=reason,
        status_line=status,
        applied=applied,
        music_source=music_source,
        bgm_url=unique,
        generative_available=gen_ok,
        voice_enrolled=bool(voice.get("enrolled")),
        voice_label=(voice.get("label") or None),
        voice_hint=(voice.get("hint") or None),
        voice_setup_path=str(voice.get("setup_path") or "/me/voice"),
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


@router.post("/library/conversations/{conversation_id}/derive-script", response_model=StoryDetail)
def derive_script(
    conversation_id: str,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Create or refresh the single Script derived from this conversation's transcript."""
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
    source = conversation_source_text(db, conv)
    if not source:
        raise HTTPException(status_code=400, detail="This conversation has no transcript yet.")
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Script derivation requires OPENAI_API_KEY.")
    script_text = derive_script_text(api_key, source)
    if not script_text or not script_text.strip():
        raise HTTPException(status_code=502, detail="Could not derive a script. Try again.")
    story = upsert_script_for_conversation(
        db,
        owner_user_id=str(current_user.id),
        conversation=conv,
        story_text=script_text.strip(),
        api_key=api_key,
    )
    logger.info(
        "library/derive-script: conversation=%s story=%s user=%s",
        conversation_id,
        story.id,
        current_user.id,
    )
    background_tasks.add_task(
        learn_from_content_job,
        str(current_user.id),
        f"Title: {story.title or ''}\n\n{story.story_text}",
        "story",
        api_key,
    )
    return _story_detail(db, story)


@router.post("/stories/confirm", response_model=StorySummaryOut)
def confirm_story(
    body: ConfirmStoryBody,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Tool-handler: upsert the private story script (one per conversation when linked)."""
    text = (body.story_text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Story text is required.")
    api_key = (settings.openai_api_key or "").strip()
    title = generate_story_title(text, api_key) if text else None
    if not title:
        title = "Story script"

    existing_id = (body.story_id or "").strip() or None
    source_id = (body.source_conversation_id or "").strip() or None
    story: models.Story | None = None

    if existing_id:
        story = (
            db.query(models.Story)
            .filter(
                models.Story.id == existing_id,
                models.Story.owner_user_id == current_user.id,
                models.Story.deleted_at.is_(None),
            )
            .first()
        )
        if not story:
            raise HTTPException(status_code=404, detail="Story not found.")
        story.story_text = text
        story.summary = text[:500]
        story.title = title
        story.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(story)
        logger.info("library/stories: updated story_id=%s user=%s", story.id, current_user.id)
    elif source_id:
        source_conv = (
            db.query(models.Conversation)
            .filter(
                models.Conversation.id == source_id,
                models.Conversation.owner_user_id == current_user.id,
                models.Conversation.deleted_at.is_(None),
            )
            .first()
        )
        if not source_conv:
            raise HTTPException(status_code=404, detail="Conversation not found.")
        story = upsert_script_for_conversation(
            db,
            owner_user_id=str(current_user.id),
            conversation=source_conv,
            story_text=text,
            api_key=api_key,
        )
        logger.info("library/stories: upserted for conversation=%s story=%s", source_id, story.id)
    else:
        story = models.Story(
            owner_user_id=current_user.id,
            source_conversation_id=None,
            title=title,
            summary=text[:500],
            story_text=text,
            tags_json=None,
        )
        db.add(story)
        db.commit()
        db.refresh(story)
        logger.info("library/stories: confirmed story_id=%s user=%s", story.id, current_user.id)

    if text and api_key:
        learn_blob = f"Title: {title}\n\n{text}"
        background_tasks.add_task(
            learn_from_content_job,
            str(current_user.id),
            learn_blob,
            "story",
            api_key,
        )

    return StorySummaryOut(
        id=str(story.id),
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        created_at=story.created_at.isoformat() if story.created_at else "",
    )


def _story_body(story: models.Story) -> tuple[str, str | None, str | None]:
    title = (story.title or "").strip() or None
    summary = (story.summary or "").strip() or None
    body = (story.story_text or story.summary or "").strip()
    return body, title, summary


@router.get("/library/stories/{story_id}/preview", response_model=PrivatePreviewOut)
def preview_story(
    story_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Curator private preview metadata (narration + BGM) — no share created."""
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
    body, title, summary = _story_body(story)
    # Prefer explicit Curate choice on the script, then prefs, then AI pick
    saved = (getattr(story, "bgm_track", None) or "").strip().lower()
    bgm = saved if saved in BGM_TRACKS else None
    if not bgm:
        prefs = get_or_create_prefs(db, str(current_user.id))
        preferred = None
        if isinstance(prefs.prefs_json, dict):
            preferred = (prefs.prefs_json.get("preferred_bgm") or "").strip() or None
        bgm = preferred if preferred in BGM_TRACKS else None
    if not bgm:
        bgm = pick_share_bgm_track(
            body,
            title,
            summary,
            openai_api_key=settings.openai_api_key,
        )
    tone = (getattr(story, "narration_tone", None) or "").strip().lower() or None
    voice = voice_enrollment_snapshot(db, str(current_user.id))
    return PrivatePreviewOut(
        kind="story",
        id=str(story.id),
        title=title,
        summary=summary,
        body_text=body or None,
        narration_url=f"/library/stories/{story.id}/narration",
        bgm_track=bgm,
        narration_tone=tone if tone in NARRATION_TONES else None,
        photo_url=_photo_url_for_story(db, story),
        bgm_url=story_bgm_url(db, story),
        voice_enrolled=bool(voice.get("enrolled")),
        voice_label=(voice.get("label") or None),
        voice_hint=(voice.get("hint") or None),
    )


@router.get("/library/stories/{story_id}/narration")
def stream_story_narration(
    story_id: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Private narrated listen-back in the owner's voice (or default TTS)."""
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
    body, _title, _summary = _story_body(story)
    if not body:
        raise HTTPException(status_code=404, detail="Nothing to narrate.")
    tone = (getattr(story, "narration_tone", None) or "").strip() or None
    try:
        audio, voice_mode, voice_note = synthesize_narration_mp3(
            db, str(current_user.id), body, narration_tone=tone
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.warning("library/narration failed story=%s err=%s", story_id, e)
        raise HTTPException(status_code=502, detail="Narration is temporarily unavailable.")
    tone_hdr = (tone or "warm").strip().lower()
    headers = {
        "X-Narration-Voice": voice_mode,
        "X-Narration-Tone": tone_hdr,
        # Tone/script changes must not reuse a stale cached MP3
        "Cache-Control": "private, no-store",
        "Access-Control-Expose-Headers": "X-Narration-Voice, X-Narration-Tone, X-Narration-Note",
    }
    if voice_note:
        # HTTP headers must be latin-1; keep the note readable for the UI
        note = (
            voice_note[:300]
            .replace("\u2019", "'")
            .replace("\u2018", "'")
            .replace("\u201c", '"')
            .replace("\u201d", '"')
            .replace("\u2014", "-")
            .replace("\u2013", "-")
        )
        headers["X-Narration-Note"] = note.encode("latin-1", errors="replace").decode("latin-1")
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers=headers,
    )
