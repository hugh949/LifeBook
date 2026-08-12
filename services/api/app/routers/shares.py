"""Share-link endpoints (Agent 4 — Content Manager).

- Owner (cookie-authed): create / list / change password / revoke
- Recipient (public): meta (minimal), unlock with password, narration, comments (post-unlock)

Every share requires a user-chosen password. No link-only shares.
"""
from __future__ import annotations

import hashlib
import logging
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.azure_storage import signed_read_url
from app.core.config import settings
from app.core.security import get_current_user, random_share_token
from app.db import models
from app.db.session import get_db
from app.services.narration import synthesize_narration_mp3
from app.services.share_bgm_track import pick_share_bgm_track
from app.services.story_curation import story_bgm_url


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shares", tags=["shares"])

PASSWORD_MIN = 4
PASSWORD_MAX = 128
# Accept legacy 4-digit codes and free-form passphrases
_ATTEMPTS: dict[str, list[float]] = defaultdict(list)
MAX_ATTEMPTS_PER_WINDOW = 5
WINDOW_SECONDS = 30


def _hash_password(share_id: str, password: str) -> str:
    return hashlib.sha256(f"{share_id}:{password}".encode("utf-8")).hexdigest()


def _normalize_password(raw: str | None) -> str:
    pw = (raw or "").strip()
    if len(pw) < PASSWORD_MIN or len(pw) > PASSWORD_MAX:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be between {PASSWORD_MIN} and {PASSWORD_MAX} characters.",
        )
    return pw


def _record_failed_attempt(token: str) -> bool:
    now = time.monotonic()
    window_start = now - WINDOW_SECONDS
    attempts = [t for t in _ATTEMPTS[token] if t > window_start]
    attempts.append(now)
    _ATTEMPTS[token] = attempts
    return len(attempts) <= MAX_ATTEMPTS_PER_WINDOW


def _clear_attempts(token: str) -> None:
    _ATTEMPTS.pop(token, None)


def _load_active_share(db: Session, token: str) -> models.Share | None:
    return (
        db.query(models.Share)
        .filter(models.Share.id == token, models.Share.revoked_at.is_(None))
        .first()
    )


def _load_target(db: Session, share: models.Share):
    if share.target_type == "conversation":
        return (
            db.query(models.Conversation)
            .filter(
                models.Conversation.id == share.target_id,
                models.Conversation.owner_user_id == share.owner_user_id,
                models.Conversation.deleted_at.is_(None),
            )
            .first()
        )
    return (
        db.query(models.Story)
        .filter(
            models.Story.id == share.target_id,
            models.Story.owner_user_id == share.owner_user_id,
            models.Story.deleted_at.is_(None),
        )
        .first()
    )


def _signed(url: str | None) -> str | None:
    if not url:
        return None
    key = (settings.azure_storage_account_key or "").strip()
    if not key:
        return url
    return signed_read_url(url, key, getattr(settings, "read_sas_ttl_minutes", 60))


def _verify_password(share: models.Share, password: str) -> bool:
    if not share.code_hash:
        return False
    return _hash_password(share.id, password) == share.code_hash


def _password_from_request(request: Request, body_password: str | None = None) -> str:
    raw = (
        (body_password or "").strip()
        or (request.query_params.get("password") or "").strip()
        or (request.query_params.get("code") or "").strip()
        or (request.headers.get("x-share-password") or "").strip()
        or (request.headers.get("x-share-code") or "").strip()
    )
    return raw


# -- Schemas ------------------------------------------------------------------


class CreateShareBody(BaseModel):
    target_type: Literal["conversation", "story"]
    target_id: str
    password: str = Field(..., min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class ChangePasswordBody(BaseModel):
    password: str = Field(..., min_length=PASSWORD_MIN, max_length=PASSWORD_MAX)


class ShareOut(BaseModel):
    token: str
    url: str
    target_type: str
    target_id: str
    has_password: bool
    created_at: str
    revoked_at: str | None = None


class ShareMetaOut(BaseModel):
    token: str
    target_type: str
    # Title/teaser withheld until unlock (minimal shell)
    title: str | None = None
    owner_display_name: str
    requires_password: bool = True
    pencil_avatar_url: str | None = None
    teaser: str | None = None


class UnlockBody(BaseModel):
    password: str | None = None
    # Legacy alias for older clients
    code: str | None = None


class PlaybackOut(BaseModel):
    token: str
    target_type: str
    title: str | None
    summary: str | None
    body_text: str | None
    narration_url: str
    bgm_track: str = "neutral"
    bgm_url: str | None = None  # unique generative bed when present
    pencil_avatar_url: str | None
    owner_display_name: str
    created_at: str
    photo_url: str | None = None


class CommentIn(BaseModel):
    recipient_name: str
    text: str
    password: str | None = None
    code: str | None = None


class CommentOut(BaseModel):
    id: str
    recipient_name: str
    text: str
    created_at: str


# -- Helpers ------------------------------------------------------------------


def _photo_url_for_story(db: Session, story: models.Story | None) -> str | None:
    if not story or not getattr(story, "photo_asset_id", None):
        return None
    asset = db.query(models.Asset).filter(models.Asset.id == story.photo_asset_id).first()
    if not asset or not asset.blob_url:
        return None
    return _signed(asset.blob_url)


def _narration_text_for_share(db: Session, share: models.Share) -> tuple[str, str | None, str | None]:
    target = _load_target(db, share)
    if not target:
        raise HTTPException(status_code=404, detail="This share is no longer available.")
    if share.target_type == "story":
        title = (target.title or "").strip() or None
        summary = (target.summary or "").strip() or None
        body = (target.story_text or target.summary or "").strip()
        return body, title, summary
    transcript = (
        db.query(models.Transcript)
        .filter(models.Transcript.conversation_id == target.id)
        .order_by(models.Transcript.created_at.asc())
        .first()
    )
    text_parts: list[str] = []
    if transcript and (transcript.text_en or transcript.text):
        text_parts.append((transcript.text_en or transcript.text).strip())
    elif isinstance(target.session_turns_json, list):
        for t in target.session_turns_json:
            if isinstance(t, dict) and t.get("role") == "user" and t.get("content"):
                text_parts.append(str(t["content"]).strip())
    title = (target.title or "").strip() or None
    summary = (target.summary or "").strip() or None
    return ("\n\n".join(text_parts)).strip(), title, summary


def _get_avatar_url(db: Session, user_id: str) -> str | None:
    row = db.query(models.UserAvatar).filter(models.UserAvatar.user_id == user_id).first()
    if not row or row.status != "ready":
        return None
    return _signed(row.pencil_blob_url)


def _share_url(token: str) -> str:
    return f"/s/{token}"


def _to_share_out(s: models.Share) -> ShareOut:
    return ShareOut(
        token=s.id,
        url=_share_url(s.id),
        target_type=s.target_type,
        target_id=s.target_id,
        has_password=bool(s.code_hash),
        created_at=s.created_at.isoformat() if s.created_at else "",
        revoked_at=s.revoked_at.isoformat() if s.revoked_at else None,
    )


def _require_unlocked(share: models.Share, password: str) -> None:
    if not password:
        raise HTTPException(status_code=401, detail="This link requires a password.")
    if not _verify_password(share, password):
        allowed = _record_failed_attempt(share.id)
        if not allowed:
            raise HTTPException(
                status_code=429,
                detail="Too many attempts. Please wait a moment and try again.",
            )
        raise HTTPException(status_code=401, detail="That password doesn't match.")
    _clear_attempts(share.id)


# -- Owner endpoints ----------------------------------------------------------


@router.post("", response_model=ShareOut)
def create_share(
    body: CreateShareBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Conversations are vault-only — share Scripts only
    if body.target_type == "conversation":
        raise HTTPException(
            status_code=400,
            detail="Conversations stay private. Share a Script after you Curate it.",
        )
    target = (
        db.query(models.Story)
        .filter(
            models.Story.id == body.target_id,
            models.Story.owner_user_id == current_user.id,
            models.Story.deleted_at.is_(None),
        )
        .first()
    )
    if not target:
        raise HTTPException(status_code=404, detail="Target not found in your library.")

    password = _normalize_password(body.password)
    token = random_share_token(16)
    share = models.Share(
        id=token,
        owner_user_id=current_user.id,
        target_type="story",
        target_id=body.target_id,
        code_hash=_hash_password(token, password),
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    logger.info(
        "shares: created token=%s owner=%s target=%s:%s",
        token,
        current_user.id,
        body.target_type,
        body.target_id,
    )
    return _to_share_out(share)


@router.get("", response_model=list[ShareOut])
def list_shares(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(models.Share)
        .filter(models.Share.owner_user_id == current_user.id)
        .order_by(models.Share.created_at.desc())
        .all()
    )
    return [_to_share_out(s) for s in rows]


@router.patch("/{token}", response_model=ShareOut)
def change_share_password(
    token: str,
    body: ChangePasswordBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    share = (
        db.query(models.Share)
        .filter(
            models.Share.id == token,
            models.Share.owner_user_id == current_user.id,
            models.Share.revoked_at.is_(None),
        )
        .first()
    )
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found.")
    password = _normalize_password(body.password)
    share.code_hash = _hash_password(token, password)
    db.commit()
    db.refresh(share)
    logger.info("shares: password changed token=%s owner=%s", token, current_user.id)
    return _to_share_out(share)


@router.delete("/{token}")
def revoke_share(
    token: str,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    share = (
        db.query(models.Share)
        .filter(models.Share.id == token, models.Share.owner_user_id == current_user.id)
        .first()
    )
    if not share:
        raise HTTPException(status_code=404, detail="Share link not found.")
    share.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return {"revoked": True}


# -- Public recipient endpoints ----------------------------------------------


@router.get("/{token}", response_model=ShareMetaOut)
def get_share_meta(token: str, db: Session = Depends(get_db)):
    """Minimal shell only — no title/teaser until unlock."""
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    owner = db.query(models.User).filter(models.User.id == share.owner_user_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    target = _load_target(db, share)
    if not target:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    return ShareMetaOut(
        token=token,
        target_type=share.target_type,
        title=None,
        owner_display_name=owner.display_name,
        requires_password=True,
        pencil_avatar_url=_get_avatar_url(db, str(owner.id)),
        teaser=None,
    )


def _build_playback(db: Session, share: models.Share, token: str) -> PlaybackOut:
    owner = db.query(models.User).filter(models.User.id == share.owner_user_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    body_text, title, summary = _narration_text_for_share(db, share)
    bgm_track = None
    story = None
    if share.target_type == "story":
        story = (
            db.query(models.Story)
            .filter(models.Story.id == share.target_id, models.Story.deleted_at.is_(None))
            .first()
        )
        saved = (getattr(story, "bgm_track", None) or "").strip().lower() if story else ""
        if saved in {"none", "neutral", "warm", "reflective", "nostalgic"}:
            bgm_track = saved
    if not bgm_track:
        bgm_track = pick_share_bgm_track(
            body_text,
            title,
            summary,
            openai_api_key=settings.openai_api_key,
        )
    unique_bgm = story_bgm_url(db, story) if story else None
    return PlaybackOut(
        token=token,
        target_type=share.target_type,
        title=title,
        summary=summary,
        body_text=body_text or None,
        narration_url=f"/shares/{token}/narration",
        bgm_track=bgm_track,
        bgm_url=unique_bgm,
        pencil_avatar_url=_get_avatar_url(db, str(owner.id)),
        owner_display_name=owner.display_name,
        created_at=share.created_at.isoformat() if share.created_at else "",
        photo_url=_photo_url_for_story(db, story) if share.target_type == "story" else None,
    )


@router.get("/{token}/playback", response_model=PlaybackOut)
def get_share_playback(token: str, db: Session = Depends(get_db)):
    """Always password-gated — use POST /unlock instead."""
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    raise HTTPException(status_code=401, detail="This link requires a password.")


@router.post("/{token}/unlock", response_model=PlaybackOut)
def unlock_share(token: str, body: UnlockBody, db: Session = Depends(get_db)):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    password = (body.password or body.code or "").strip()
    _require_unlocked(share, password)
    return _build_playback(db, share, token)


@router.get("/{token}/narration")
def stream_narration(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    password = _password_from_request(request)
    _require_unlocked(share, password)

    body_text, _title, _summary = _narration_text_for_share(db, share)
    if not body_text:
        raise HTTPException(status_code=404, detail="Nothing to narrate for this share.")

    tone = None
    if share.target_type == "story":
        story = (
            db.query(models.Story)
            .filter(models.Story.id == share.target_id, models.Story.deleted_at.is_(None))
            .first()
        )
        tone = (getattr(story, "narration_tone", None) or "").strip() or None if story else None

    try:
        audio, voice_mode, voice_note = synthesize_narration_mp3(
            db, str(share.owner_user_id), body_text, narration_tone=tone
        )
    except ValueError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.warning("shares/narration failed token=%s err=%s", token, e)
        raise HTTPException(status_code=502, detail="Narration is temporarily unavailable.")

    headers = {
        "X-Narration-Voice": voice_mode,
        "Cache-Control": "private, no-store",
        "Access-Control-Expose-Headers": "X-Narration-Voice, X-Narration-Note",
    }
    if voice_note:
        headers["X-Narration-Note"] = voice_note[:300]
    return Response(
        content=audio,
        media_type="audio/mpeg",
        headers=headers,
    )


@router.post("/{token}/comments", response_model=CommentOut)
def add_comment(
    token: str,
    body: CommentIn,
    db: Session = Depends(get_db),
):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    password = (body.password or body.code or "").strip()
    _require_unlocked(share, password)

    name = (body.recipient_name or "").strip()
    text = (body.text or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Please share your name.")
    if not text:
        raise HTTPException(status_code=400, detail="Comment cannot be empty.")
    if len(text) > 2000:
        text = text[:2000]
    if len(name) > 120:
        name = name[:120]
    comment = models.ShareComment(share_id=share.id, recipient_name=name, text=text)
    db.add(comment)
    db.commit()
    db.refresh(comment)
    return CommentOut(
        id=str(comment.id),
        recipient_name=comment.recipient_name,
        text=comment.text,
        created_at=comment.created_at.isoformat() if comment.created_at else "",
    )


@router.get("/{token}/comments", response_model=list[CommentOut])
def list_share_comments(token: str, request: Request, db: Session = Depends(get_db)):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    password = _password_from_request(request)
    _require_unlocked(share, password)

    rows = (
        db.query(models.ShareComment)
        .filter(models.ShareComment.share_id == share.id)
        .order_by(models.ShareComment.created_at.desc())
        .all()
    )
    return [
        CommentOut(
            id=str(r.id),
            recipient_name=r.recipient_name,
            text=r.text,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]
