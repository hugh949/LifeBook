"""Shared TTS narration helper (Curator Agent 3 + share playback)."""
from __future__ import annotations

import logging
from typing import Literal

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.openai_models import curator_tts_model
from app.db import models

logger = logging.getLogger(__name__)

ELEVENLABS_TTS_URL_TEMPLATE = "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
OPENAI_TTS_VOICE = "alloy"
TTS_MAX_CHARS = 4096

VoiceMode = Literal["cloned", "default", "default_fallback"]


# Distinct speaking styles — used for OpenAI TTS instructions and ElevenLabs voice_settings.
_TONE_INSTRUCTIONS = {
    "warm": (
        "Speak warmly and kindly, like sharing a treasured memory with someone you love. "
        "Soft smile in the voice, gentle rises on meaningful words."
    ),
    "gentle": (
        "Speak very gently and softly, unhurried, with a calm caring presence. "
        "Slightly quieter energy, longer pauses between sentences."
    ),
    "clear": (
        "Speak clearly and naturally at a comfortable, even pace, easy to follow. "
        "Crisp diction, steady volume, minimal ornament."
    ),
    "lively": (
        "Speak with light energy and warmth — still natural and easy to listen to. "
        "Slightly brighter tone and a bit more forward momentum."
    ),
}

# ElevenLabs multilingual v2: stability / similarity / style (0–1) per tone so differences are audible.
_TONE_ELEVENLABS = {
    "warm": {"stability": 0.42, "similarity_boost": 0.78, "style": 0.35, "use_speaker_boost": True},
    "gentle": {"stability": 0.62, "similarity_boost": 0.72, "style": 0.12, "use_speaker_boost": True},
    "clear": {"stability": 0.55, "similarity_boost": 0.7, "style": 0.05, "use_speaker_boost": True},
    "lively": {"stability": 0.28, "similarity_boost": 0.8, "style": 0.55, "use_speaker_boost": True},
}


def voice_enrollment_snapshot(db: Session, owner_user_id: str) -> dict:
    """Quiet status for Curate UI + Curator context (no TTS call)."""
    row = (
        db.query(models.UserVoice)
        .filter(models.UserVoice.user_id == owner_user_id)
        .first()
    )
    status = (row.clone_status if row else None) or "none"
    voice_id = ((row.elevenlabs_voice_id if row else None) or "").strip() or None
    key_ok = bool((settings.elevenlabs_api_key or "").strip())
    enrolled = bool(voice_id and status == "ready")
    if enrolled and key_ok:
        mode = "cloned"
        label = "Narration: your voice"
        hint = None
    elif enrolled and not key_ok:
        mode = "default"
        label = "Narration: default voice"
        hint = "Your voice is enrolled, but voice playback isn't configured on this server right now."
    elif status == "failed":
        mode = "default"
        label = "Narration: default voice"
        hint = (row.clone_error if row else None) or "Voice setup didn't finish — try again in Me → Voice."
    elif status == "processing":
        mode = "default"
        label = "Narration: default voice"
        hint = "Your voice is still being prepared."
    else:
        mode = "default"
        label = "Narration: default voice — Curator can help you enroll"
        hint = "Set up your voice so Listen uses you, not a stand-in."
    return {
        "clone_status": status,
        "enrolled": enrolled,
        "mode": mode,
        "label": label,
        "hint": hint,
        "setup_path": "/me/voice",
        "elevenlabs_configured": key_ok,
    }


def synthesize_narration_mp3(
    db: Session,
    owner_user_id: str,
    body_text: str,
    *,
    narration_tone: str | None = None,
    story_specific: bool = True,
) -> tuple[bytes, VoiceMode, str | None]:
    """Return (mp3_bytes, voice_mode, note).

    voice_mode:
      - cloned: ElevenLabs enrolled voice used
      - default: no usable clone; OpenAI (or configured) default TTS
      - default_fallback: clone was expected but ElevenLabs failed; fell back openly

    note is plain-language when not using their voice as expected.
    Raises ValueError when no TTS provider is configured.
    """
    text = (body_text or "").strip()[:TTS_MAX_CHARS]
    if not text:
        raise ValueError("Nothing to narrate.")

    tone_key = (narration_tone or "").strip().lower() or "warm"
    style = _TONE_INSTRUCTIONS.get(tone_key) or (
        f"Speak in a {tone_key} manner, natural and suitable for a personal story."
    )
    if story_specific:
        from app.services.story_curation import story_specific_tts_addon

        addon = story_specific_tts_addon(text, tone_key)
        if addon:
            style = f"{style}{addon}"
    eleven_settings = _TONE_ELEVENLABS.get(tone_key) or _TONE_ELEVENLABS["warm"]

    voice_row = (
        db.query(models.UserVoice)
        .filter(models.UserVoice.user_id == owner_user_id)
        .first()
    )
    clone_status = (voice_row.clone_status if voice_row else None) or "none"
    voice_id = ((voice_row.elevenlabs_voice_id if voice_row else None) or "").strip() or None
    elevenlabs_key = (settings.elevenlabs_api_key or "").strip()
    want_clone = bool(voice_id and clone_status == "ready")

    if want_clone and not elevenlabs_key:
        logger.warning("narration: enrolled voice but ELEVENLABS_API_KEY unset owner=%s", owner_user_id)
        # Fall through to default with an honest note
        note = "Your voice is enrolled, but the voice service isn't available — using a default voice for now."
        return _openai_tts(text, tone_key, style), "default_fallback", note

    if want_clone and elevenlabs_key:
        try:
            payload: dict = {
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": eleven_settings,
            }
            with httpx.Client(timeout=60.0) as client:
                r = client.post(
                    ELEVENLABS_TTS_URL_TEMPLATE.format(voice_id=voice_id),
                    headers={
                        "xi-api-key": elevenlabs_key,
                        "Content-Type": "application/json",
                        "Accept": "audio/mpeg",
                    },
                    params={"output_format": "mp3_44100_128"},
                    json=payload,
                )
            r.raise_for_status()
            if not r.content or len(r.content) < 100:
                raise RuntimeError("Empty ElevenLabs TTS body")
            return r.content, "cloned", None
        except httpx.HTTPStatusError as e:
            code = e.response.status_code
            body_snip = (e.response.text or "")[:200]
            logger.warning(
                "narration: ElevenLabs HTTP %s owner=%s err=%s",
                code,
                owner_user_id,
                body_snip,
            )
            low = body_snip.lower()
            if "quota_exceeded" in low or code == 429:
                note = "Voice service is busy or out of credits - using a default voice for now."
            elif code in (401, 403):
                note = "Couldn't use your voice (account or key issue) - using a default voice for now."
            else:
                note = "Couldn't use your voice right now - using a default voice for now."
            return _openai_tts(text, tone_key, style), "default_fallback", note
        except Exception as e:
            logger.warning("narration: ElevenLabs failed owner=%s err=%s", owner_user_id, e)
            note = "Couldn't use your voice right now - using a default voice for now."
            return _openai_tts(text, tone_key, style), "default_fallback", note

    return _openai_tts(text, tone_key, style), "default", None


def _openai_tts(text: str, tone_key: str, style: str) -> bytes:
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise ValueError("Narration is not configured on this server.")
    body: dict = {
        "model": curator_tts_model(settings.openai_curator_tts_model),
        "input": text,
        "voice": OPENAI_TTS_VOICE,
        "response_format": "mp3",
        "speed": 0.96 if tone_key == "gentle" else (1.06 if tone_key == "lively" else 1.0),
        "instructions": style,
    }
    with httpx.Client(timeout=60.0) as client:
        r = client.post(
            OPENAI_TTS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
    r.raise_for_status()
    return r.content
