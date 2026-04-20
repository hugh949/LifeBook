"""Share-link endpoints.

- Owner endpoints (cookie-authed):
    POST /shares                  create a share link
    GET  /shares                  list own share links
    DELETE /shares/{token}         revoke a share link
- Recipient endpoints (public):
    GET  /shares/{token}           meta (requires_code?, title, owner, avatar?)
    POST /shares/{token}/unlock    verify 4-digit code + return playback data
    GET  /shares/{token}/playback  playback data when no code is set
    GET  /shares/{token}/narration stream cloned-voice narration MP3
    POST /shares/{token}/comments  leave a comment
    GET  /shares/{token}/comments  list comments (recipients can see each other)
"""
from __future__ import annotations

import hashlib
import logging
import re
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.azure_storage import signed_read_url
from app.core.config import settings
from app.core.security import get_current_user, random_share_token
from app.db import models
from app.db.session import get_db


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/shares", tags=["shares"])


CODE_RE = re.compile(r"^\d{4}$")
ELEVENLABS_TTS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_TTS_MODEL = "tts-1-hd"
OPENAI_TTS_VOICE = "alloy"
TTS_MAX_CHARS = 4096

# Simple in-memory rate limit for code attempts per-token. Pilot-only.
_ATTEMPTS: dict[str, list[float]] = defaultdict(list)
MAX_ATTEMPTS_PER_WINDOW = 5
WINDOW_SECONDS = 30


def _hash_code(share_id: str, code: str) -> str:
    return hashlib.sha256(f"{share_id}:{code}".encode("utf-8")).hexdigest()


def _record_failed_attempt(token: str) -> bool:
    """Return False if cool-down should kick in. True = allowed."""
    now = time.monotonic()
    window_start = now - WINDOW_SECONDS
    attempts = [t for t in _ATTEMPTS[token] if t > window_start]
    attempts.append(now)
    _ATTEMPTS[token] = attempts
    return len(attempts) <= MAX_ATTEMPTS_PER_WINDOW


def _clear_attempts(token: str) -> None:
    _ATTEMPTS.pop(token, None)


def _load_active_share(db: Session, token: str) -> models.Share | None:
    row = (
        db.query(models.Share)
        .filter(models.Share.id == token, models.Share.revoked_at.is_(None))
        .first()
    )
    return row


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


# -- Schemas ------------------------------------------------------------------


class CreateShareBody(BaseModel):
    target_type: Literal["conversation", "story"]
    target_id: str
    code: str | None = None  # optional 4-digit code


class ShareOut(BaseModel):
    token: str
    url: str
    target_type: str
    target_id: str
    has_code: bool
    created_at: str
    revoked_at: str | None = None


class ShareMetaOut(BaseModel):
    token: str
    target_type: str
    title: str | None
    owner_display_name: str
    requires_code: bool
    pencil_avatar_url: str | None
    # Short teaser line visible without unlock
    teaser: str | None


class UnlockBody(BaseModel):
    code: str


class PlaybackOut(BaseModel):
    token: str
    target_type: str
    title: str | None
    summary: str | None
    body_text: str | None  # full text to narrate (story_text or transcript)
    narration_url: str  # server-signed narration URL
    pencil_avatar_url: str | None
    owner_display_name: str
    created_at: str


class CommentIn(BaseModel):
    recipient_name: str
    text: str


class CommentOut(BaseModel):
    id: str
    recipient_name: str
    text: str
    created_at: str


# -- Helpers ------------------------------------------------------------------


def _narration_text_for_share(db: Session, share: models.Share) -> tuple[str, str | None, str | None]:
    """Return (body_text, title, summary) for narration."""
    target = _load_target(db, share)
    if not target:
        raise HTTPException(status_code=404, detail="This share is no longer available.")
    if share.target_type == "story":
        title = (target.title or "").strip() or None
        summary = (target.summary or "").strip() or None
        body = (target.story_text or target.summary or "").strip()
        return body, title, summary
    # conversation: use transcript fallback, then turns
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
    # Pilot: relative path. Frontend rewrites to full URL using window.origin at copy time.
    return f"/s/{token}"


# -- Owner endpoints ----------------------------------------------------------


@router.post("", response_model=ShareOut)
def create_share(
    body: CreateShareBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Validate the target belongs to the user
    if body.target_type == "conversation":
        target = (
            db.query(models.Conversation)
            .filter(
                models.Conversation.id == body.target_id,
                models.Conversation.owner_user_id == current_user.id,
                models.Conversation.deleted_at.is_(None),
            )
            .first()
        )
    else:
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

    code = (body.code or "").strip() or None
    if code and not CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="Code must be exactly 4 digits.")

    token = random_share_token(16)
    code_hash = _hash_code(token, code) if code else None
    share = models.Share(
        id=token,
        owner_user_id=current_user.id,
        target_type=body.target_type,
        target_id=body.target_id,
        code_hash=code_hash,
    )
    db.add(share)
    db.commit()
    db.refresh(share)
    logger.info(
        "shares: created token=%s owner=%s target=%s:%s has_code=%s",
        token,
        current_user.id,
        body.target_type,
        body.target_id,
        bool(code_hash),
    )
    return ShareOut(
        token=token,
        url=_share_url(token),
        target_type=share.target_type,
        target_id=share.target_id,
        has_code=bool(share.code_hash),
        created_at=share.created_at.isoformat() if share.created_at else "",
    )


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
    return [
        ShareOut(
            token=s.id,
            url=_share_url(s.id),
            target_type=s.target_type,
            target_id=s.target_id,
            has_code=bool(s.code_hash),
            created_at=s.created_at.isoformat() if s.created_at else "",
            revoked_at=s.revoked_at.isoformat() if s.revoked_at else None,
        )
        for s in rows
    ]


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
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    owner = db.query(models.User).filter(models.User.id == share.owner_user_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    target = _load_target(db, share)
    if not target:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    title = (getattr(target, "title", None) or "").strip() or None
    teaser = (getattr(target, "summary", None) or "").strip() or None
    if teaser and len(teaser) > 160:
        teaser = teaser[:160].rstrip() + "…"
    return ShareMetaOut(
        token=token,
        target_type=share.target_type,
        title=title,
        owner_display_name=owner.display_name,
        requires_code=bool(share.code_hash),
        pencil_avatar_url=_get_avatar_url(db, str(owner.id)),
        teaser=teaser,
    )


def _build_playback(db: Session, share: models.Share, token: str) -> PlaybackOut:
    owner = db.query(models.User).filter(models.User.id == share.owner_user_id).first()
    if not owner:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    body_text, title, summary = _narration_text_for_share(db, share)
    narration_url = f"/shares/{token}/narration"
    return PlaybackOut(
        token=token,
        target_type=share.target_type,
        title=title,
        summary=summary,
        body_text=body_text or None,
        narration_url=narration_url,
        pencil_avatar_url=_get_avatar_url(db, str(owner.id)),
        owner_display_name=owner.display_name,
        created_at=share.created_at.isoformat() if share.created_at else "",
    )


@router.get("/{token}/playback", response_model=PlaybackOut)
def get_share_playback(token: str, db: Session = Depends(get_db)):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    if share.code_hash:
        raise HTTPException(status_code=401, detail="This link requires a code.")
    return _build_playback(db, share, token)


@router.post("/{token}/unlock", response_model=PlaybackOut)
def unlock_share(token: str, body: UnlockBody, db: Session = Depends(get_db)):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    code = (body.code or "").strip()
    if not CODE_RE.match(code):
        raise HTTPException(status_code=400, detail="Code must be exactly 4 digits.")
    if not share.code_hash:
        # No code required, just return playback
        return _build_playback(db, share, token)
    allowed = _record_failed_attempt(token)
    if not allowed:
        raise HTTPException(status_code=429, detail="Too many attempts. Please wait a moment and try again.")
    if _hash_code(token, code) != share.code_hash:
        raise HTTPException(status_code=401, detail="That code doesn't match.")
    _clear_attempts(token)
    return _build_playback(db, share, token)


@router.get("/{token}/narration")
def stream_narration(
    token: str,
    request: Request,
    db: Session = Depends(get_db),
):
    """Stream cloned-voice narration for the share.

    If the share requires a code, the caller must have already unlocked (signified
    by the ``x-share-unlocked`` header carrying the correct code). For unprotected
    shares, direct GET works — which keeps the ``<audio src>`` flow simple.
    """
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
    if share.code_hash:
        # For pilot, require code to be re-sent via query or header to fetch audio.
        provided_code = request.query_params.get("code") or request.headers.get("x-share-code") or ""
        provided_code = provided_code.strip()
        if not CODE_RE.match(provided_code) or _hash_code(token, provided_code) != share.code_hash:
            raise HTTPException(status_code=401, detail="This link requires a code.")

    body_text, _title, _summary = _narration_text_for_share(db, share)
    if not body_text:
        raise HTTPException(status_code=404, detail="Nothing to narrate for this share.")
    text = body_text[:TTS_MAX_CHARS]

    # Prefer cloned voice if available
    voice_row = (
        db.query(models.UserVoice)
        .filter(models.UserVoice.user_id == share.owner_user_id)
        .first()
    )
    voice_id = (voice_row.elevenlabs_voice_id if voice_row else None) or None
    elevenlabs_key = (settings.elevenlabs_api_key or "").strip()
    if voice_id and elevenlabs_key:
        try:
            with httpx.Client(timeout=60.0) as client:
                r = client.post(
                    ELEVENLABS_TTS_URL_TEMPLATE.format(voice_id=voice_id),
                    headers={
                        "xi-api-key": elevenlabs_key,
                        "Content-Type": "application/json",
                        "Accept": "audio/mpeg",
                    },
                    params={"output_format": "mp3_44100_128"},
                    json={"text": text, "model_id": "eleven_multilingual_v2"},
                )
            r.raise_for_status()
            return Response(
                content=r.content,
                media_type="audio/mpeg",
                headers={"X-Narration-Voice": "cloned", "Cache-Control": "private, max-age=3600"},
            )
        except Exception as e:
            logger.warning("shares/narration: ElevenLabs failed owner=%s token=%s err=%s", share.owner_user_id, token, e)
    # Fallback: OpenAI TTS
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Narration is not configured on this server.")
    try:
        with httpx.Client(timeout=60.0) as client:
            r = client.post(
                OPENAI_TTS_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENAI_TTS_MODEL,
                    "input": text,
                    "voice": OPENAI_TTS_VOICE,
                    "response_format": "mp3",
                    "speed": 1.0,
                },
            )
        r.raise_for_status()
        return Response(
            content=r.content,
            media_type="audio/mpeg",
            headers={"X-Narration-Voice": "default", "Cache-Control": "private, max-age=3600"},
        )
    except Exception as e:
        logger.warning("shares/narration: OpenAI fallback failed err=%s", e)
        raise HTTPException(status_code=502, detail="Narration is temporarily unavailable.")


@router.post("/{token}/comments", response_model=CommentOut)
def add_comment(
    token: str,
    body: CommentIn,
    db: Session = Depends(get_db),
):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
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
def list_share_comments(token: str, db: Session = Depends(get_db)):
    share = _load_active_share(db, token)
    if not share:
        raise HTTPException(status_code=404, detail="This link is no longer available.")
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
