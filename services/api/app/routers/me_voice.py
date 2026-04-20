"""Voice-clone wizard endpoints: lifecycle status + audio upload that drives
ElevenLabs voice cloning. Replaces the old /voice/participants/{id}/... split.

Clone lifecycle: ``none | recording | processing | ready | failed``.
The UI is stateful and polls ``GET /me/voice`` to advance.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.audio_convert import to_wav_16k_mono


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/me/voice", tags=["me_voice"])


NARRATION_VOICE_MIN_BYTES = 1_920_000  # ~60s at 16 kHz 16-bit mono
ELEVENLABS_ADD_VOICE_URL = "https://api.elevenlabs.io/v1/voices/add"
ELEVENLABS_TTS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
ELEVENLABS_DELETE_VOICE_TEMPLATE = "https://api.elevenlabs.io/v1/voices/{voice_id}"
SAMPLE_SENTENCE = "Hi, this is how a story will sound in my voice when I share it."


class VoiceStatusOut(BaseModel):
    status: str  # none | recording | processing | ready | failed
    voice_id: str | None = None
    consent_at: str | None = None
    error: str | None = None
    min_bytes: int = NARRATION_VOICE_MIN_BYTES


def _ensure_user_voice(db: Session, user_id: str) -> models.UserVoice:
    row = db.query(models.UserVoice).filter(models.UserVoice.user_id == user_id).first()
    if not row:
        row = models.UserVoice(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _to_status(row: models.UserVoice) -> VoiceStatusOut:
    return VoiceStatusOut(
        status=row.clone_status or "none",
        voice_id=(row.elevenlabs_voice_id or None),
        consent_at=row.elevenlabs_voice_consent_at.isoformat() if row.elevenlabs_voice_consent_at else None,
        error=row.clone_error or None,
    )


@router.get("", response_model=VoiceStatusOut)
def get_voice_status(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _ensure_user_voice(db, str(current_user.id))
    return _to_status(row)


@router.post("/clone", response_model=VoiceStatusOut)
async def create_clone(
    audio: UploadFile = File(..., description="WAV (or convertible) 60s+ of clear speech"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload the user's recording and create an ElevenLabs cloned voice."""
    api_key = (settings.elevenlabs_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Voice cloning is not configured on this server.")

    try:
        body = await audio.read()
    except Exception as e:
        logger.warning("me/voice/clone: read body %s", e)
        raise HTTPException(status_code=400, detail="Could not read audio")
    if len(body) < NARRATION_VOICE_MIN_BYTES:
        raise HTTPException(
            status_code=400,
            detail="Please record at least 60 seconds of clear speech.",
        )
    content_type = getattr(audio, "content_type", "") or ""
    if not (body[:4] == b"RIFF" and body[8:12] == b"WAVE"):
        converted = to_wav_16k_mono(body, content_type)
        if not converted:
            raise HTTPException(
                status_code=400,
                detail="Audio format not supported. Please record as WAV.",
            )
        body = converted

    row = _ensure_user_voice(db, str(current_user.id))
    row.clone_status = "processing"
    row.clone_error = None
    db.commit()

    name = f"lifebook-{current_user.id}"
    try:
        with httpx.Client(timeout=120.0) as client:
            r = client.post(
                ELEVENLABS_ADD_VOICE_URL,
                headers={"xi-api-key": api_key},
                files={"files": ("audio.wav", body, "audio/wav")},
                data={"name": name, "remove_background_noise": "true"},
            )
        r.raise_for_status()
        data = r.json()
        voice_id = (data.get("voice_id") or "").strip()
        if not voice_id:
            raise RuntimeError("ElevenLabs did not return a voice_id")
        # Smoke-test TTS so we know the voice is usable before showing "Ready"
        try:
            with httpx.Client(timeout=20.0) as tts_client:
                tts_r = tts_client.post(
                    ELEVENLABS_TTS_URL_TEMPLATE.format(voice_id=voice_id),
                    headers={
                        "xi-api-key": api_key,
                        "Content-Type": "application/json",
                        "Accept": "audio/mpeg",
                    },
                    params={"output_format": "mp3_44100_128"},
                    json={"text": "Hello.", "model_id": "eleven_multilingual_v2"},
                )
            tts_r.raise_for_status()
            if not tts_r.content or len(tts_r.content) < 100:
                raise RuntimeError("Empty TTS response")
        except Exception as verify_err:
            logger.warning("me/voice/clone: TTS smoke-test failed voice_id=%s err=%s", voice_id, verify_err)
            row.clone_status = "failed"
            row.clone_error = "Voice clone was created but isn't ready yet. Try recording again."
            db.commit()
            raise HTTPException(status_code=502, detail=row.clone_error)
    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        msg = (e.response.text or str(e))[:400]
        row.clone_status = "failed"
        if e.response.status_code == 422:
            row.clone_error = "That recording didn't work for cloning. Try again with 1+ minute of clearer speech."
        else:
            row.clone_error = "ElevenLabs error: " + msg
        db.commit()
        raise HTTPException(status_code=400 if e.response.status_code == 422 else 502, detail=row.clone_error)
    except Exception as e:
        logger.exception("me/voice/clone: %s", e)
        row.clone_status = "failed"
        row.clone_error = str(e)
        db.commit()
        raise HTTPException(status_code=502, detail=str(e))

    row.elevenlabs_voice_id = voice_id
    row.elevenlabs_voice_consent_at = datetime.now(timezone.utc)
    row.clone_status = "ready"
    row.clone_error = None
    db.commit()
    db.refresh(row)
    logger.info("me/voice/clone: user=%s voice_id=%s ready", current_user.id, voice_id)
    return _to_status(row)


@router.post("/sample")
def voice_sample(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return a short MP3 narration of `SAMPLE_SENTENCE` using the user's cloned voice."""
    from fastapi.responses import Response

    row = _ensure_user_voice(db, str(current_user.id))
    voice_id = (row.elevenlabs_voice_id or "").strip()
    api_key = (settings.elevenlabs_api_key or "").strip()
    if not voice_id or not api_key:
        raise HTTPException(status_code=404, detail="No cloned voice available.")
    try:
        with httpx.Client(timeout=30.0) as client:
            r = client.post(
                ELEVENLABS_TTS_URL_TEMPLATE.format(voice_id=voice_id),
                headers={
                    "xi-api-key": api_key,
                    "Content-Type": "application/json",
                    "Accept": "audio/mpeg",
                },
                params={"output_format": "mp3_44100_128"},
                json={"text": SAMPLE_SENTENCE, "model_id": "eleven_multilingual_v2"},
            )
        r.raise_for_status()
        return Response(content=r.content, media_type="audio/mpeg")
    except Exception as e:
        logger.warning("me/voice/sample: %s", e)
        raise HTTPException(status_code=502, detail="Could not generate a voice sample right now.")


@router.delete("", response_model=VoiceStatusOut)
def delete_voice(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete the user's cloned voice and reset the wizard state."""
    row = _ensure_user_voice(db, str(current_user.id))
    api_key = (settings.elevenlabs_api_key or "").strip()
    voice_id = (row.elevenlabs_voice_id or "").strip()
    if api_key and voice_id:
        try:
            with httpx.Client(timeout=30.0) as client:
                client.delete(
                    ELEVENLABS_DELETE_VOICE_TEMPLATE.format(voice_id=voice_id),
                    headers={"xi-api-key": api_key},
                )
        except Exception as e:
            logger.warning("me/voice/delete: ElevenLabs delete failed voice_id=%s err=%s", voice_id, e)
    row.elevenlabs_voice_id = None
    row.elevenlabs_voice_consent_at = None
    row.clone_status = "none"
    row.clone_error = None
    db.commit()
    db.refresh(row)
    return _to_status(row)
