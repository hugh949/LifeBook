"""Agent-led Curate: suggest music + speaking tone, optional unique generative bed.

Fast path: OpenAI/heuristics pick a library mood + narration tone and a short reason.
Unique bed: when ELEVENLABS_API_KEY + Azure are configured, generate once per story,
cache via story_bgm_cache / stories.bgm_asset_id, and fall back to the library bed.
"""
from __future__ import annotations

import logging
import re
from typing import Any, Literal
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from app.core.azure_storage import generate_upload_sas, signed_read_url
from app.core.config import settings
from app.core.openai_models import curator_model
from app.db import models
from app.services.ai_recall import generate_narrate_music_prompt
from app.services.music_generation import generate_bgm_audio
from app.services.openai_chat import chat_text
from app.services.share_bgm_track import TRACK_IDS, pick_share_bgm_track

logger = logging.getLogger(__name__)

BgmTrackId = Literal["none", "neutral", "warm", "reflective", "nostalgic"]
ToneId = Literal["warm", "gentle", "clear", "lively"]

BGM_TRACKS = frozenset({"none", "neutral", "warm", "reflective", "nostalgic"})
NARRATION_TONES = frozenset({"warm", "gentle", "clear", "lively"})

_BGM_LABELS = {
    "none": "None",
    "neutral": "Calm",
    "warm": "Warm",
    "reflective": "Reflective",
    "nostalgic": "Nostalgic",
}
_TONE_LABELS = {
    "warm": "Warm",
    "gentle": "Soft",
    "clear": "Clear",
    "lively": "Lively",
}


def bgm_label(track: str | None) -> str:
    return _BGM_LABELS.get((track or "").strip().lower(), "Calm")


def tone_label(tone: str | None) -> str:
    return _TONE_LABELS.get((tone or "").strip().lower(), "Warm")


def _heuristic_tone(blob: str) -> ToneId:
    low = blob.lower()
    if any(p in low for p in ("grief", "passed away", "loss", "miss you", "lonely", "hard time", "regret")):
        return "gentle"
    if any(p in low for p in ("wedding", "celebration", "joy", "proud", "happy", "adventure", "laugh")):
        return "lively"
    if any(p in low for p in ("explain", "how we", "first time", "lesson", "advice")):
        return "clear"
    return "warm"


def _openai_curate_pick(blob: str, api_key: str, model: str = "") -> tuple[BgmTrackId, ToneId, str] | None:
    """Ask Curator model for mood + tone + one-line why. Returns None on failure."""
    text = chat_text(
        api_key=api_key,
        model=curator_model(model),
        messages=[
            {
                "role": "system",
                "content": (
                    "You are LifeBook's Curator. Choose finishing touches for a spoken personal story.\n"
                    "Reply with exactly three lines:\n"
                    "1) bgm: one of none, neutral, warm, reflective, nostalgic\n"
                    "2) tone: one of warm, gentle, clear, lively\n"
                    "3) why: one short sentence (under 140 chars) explaining the choice for this story.\n"
                    "Prefer a distinctive pairing that fits this story — not the same safe defaults every time.\n"
                    "bgm none = voice only. reflective = quiet/inward; nostalgic = looking back; "
                    "warm = love/joy; neutral = everyday/mixed. "
                    "tone gentle = soft/unhurried; lively = light energy; clear = easy to follow; warm = kind/close."
                ),
            },
            {"role": "user", "content": blob[:4000]},
        ],
        max_completion_tokens=200,
        temperature=0.4,
        reasoning_effort="none",
        timeout=18.0,
        log_label="story_curation.pick",
    )
    if not text:
        return None
    lines = [ln.strip() for ln in text.strip().splitlines() if ln.strip()]
    bgm: str | None = None
    tone: str | None = None
    why = ""
    for ln in lines:
        low = ln.lower()
        if low.startswith("bgm"):
            word = re.sub(r"[^a-z]", "", low.split(":", 1)[-1].strip().split()[0] if ":" in low else "")
            if not word:
                m = re.search(r"\b(none|neutral|warm|reflective|nostalgic)\b", low)
                word = m.group(1) if m else ""
            if word in BGM_TRACKS:
                bgm = word
        elif low.startswith("tone"):
            word = re.sub(r"[^a-z]", "", low.split(":", 1)[-1].strip().split()[0] if ":" in low else "")
            if not word:
                m = re.search(r"\b(warm|gentle|clear|lively)\b", low)
                word = m.group(1) if m else ""
            if word in NARRATION_TONES:
                tone = word
        elif low.startswith("why"):
            why = ln.split(":", 1)[-1].strip() if ":" in ln else ln
    if not bgm or not tone:
        # Fallback: scan whole reply for first valid tokens
        low_all = text.lower()
        if not bgm:
            m = re.search(r"\b(none|neutral|warm|reflective|nostalgic)\b", low_all)
            bgm = m.group(1) if m else None
        if not tone:
            m = re.search(r"\b(warm|gentle|clear|lively)\b", low_all)
            # Prefer tone after "tone" if present; else first match that isn't also a bgm word conflict
            tone = m.group(1) if m else None
            if tone == "warm" and bgm == "warm" and "gentle" in low_all:
                tone = "gentle"
    if not bgm or not tone:
        return None
    if not why:
        why = f"Fits the mood of this memory with {bgm_label(bgm).lower()} music and a {tone_label(tone).lower()} voice."
    return bgm, tone, why[:200]  # type: ignore[return-value]


def suggest_curation(
    body_text: str,
    title: str | None,
    summary: str | None,
    *,
    openai_api_key: str,
    model: str = "",
) -> dict[str, str]:
    """Return bgm_track, narration_tone, reason (human-readable)."""
    parts = [title or "", summary or "", (body_text or "")[:4000]]
    blob = "\n\n".join(p.strip() for p in parts if p and p.strip()).strip()
    if not blob:
        return {
            "bgm_track": "neutral",
            "narration_tone": "warm",
            "reason": "Started with calm music and a warm tone — talk with Curator to change either.",
        }

    key = (openai_api_key or "").strip()
    if key:
        picked = _openai_curate_pick(blob, key, model)
        if picked:
            bgm, tone, why = picked
            return {
                "bgm_track": bgm,
                "narration_tone": tone,
                "reason": why,
            }

    bgm = pick_share_bgm_track(body_text, title, summary, openai_api_key="")
    tone = _heuristic_tone(blob)
    return {
        "bgm_track": bgm,
        "narration_tone": tone,
        "reason": (
            f"Chose {bgm_label(bgm)} music and a {tone_label(tone)} tone "
            f"to match the feeling of this story."
        ),
    }


def format_curator_status(bgm_track: str | None, narration_tone: str | None, *, has_unique_bed: bool = False) -> str:
    mood = bgm_label(bgm_track)
    tone = tone_label(narration_tone)
    if (bgm_track or "").strip().lower() == "none":
        music = "voice only"
    elif has_unique_bed:
        music = f"unique bed ({mood})"
    else:
        music = f"{mood} music"
    return f"Curator set: {music} · {tone} — tap Listen to hear"


def _bgm_url_for_asset(db: Session, asset_id: str | None) -> str | None:
    if not asset_id:
        return None
    asset = db.query(models.Asset).filter(models.Asset.id == asset_id).first()
    if not asset or not asset.blob_url:
        return None
    key = (settings.azure_storage_account_key or "").strip()
    if not key:
        return asset.blob_url
    return signed_read_url(asset.blob_url, key, getattr(settings, "read_sas_ttl_minutes", 60))


def story_bgm_url(db: Session, story: models.Story) -> str | None:
    """Signed URL for a unique generative bed, if present."""
    aid = getattr(story, "bgm_asset_id", None)
    if not aid:
        cache = (
            db.query(models.StoryBgmCache)
            .filter(models.StoryBgmCache.story_id == story.id)
            .first()
        )
        if cache:
            aid = cache.asset_id
            if not story.bgm_asset_id:
                story.bgm_asset_id = cache.asset_id
    return _bgm_url_for_asset(db, str(aid) if aid else None)


def generative_music_available() -> bool:
    return bool(
        (settings.elevenlabs_api_key or "").strip()
        and (settings.azure_storage_account or "").strip()
        and (settings.azure_storage_account_key or "").strip()
    )


def clear_story_generated_bgm(db: Session, story: models.Story) -> None:
    """Drop unique bed when user/agent switches to a library mood."""
    story.bgm_asset_id = None
    cache = (
        db.query(models.StoryBgmCache)
        .filter(models.StoryBgmCache.story_id == story.id)
        .first()
    )
    if cache:
        db.delete(cache)


def _upload_bgm_bytes(owner_user_id: str, data: bytes) -> str | None:
    account = (settings.azure_storage_account or "").strip()
    key = (settings.azure_storage_account_key or "").strip()
    if not account or not key:
        return None
    container = settings.audio_container or "audio"
    blob_path = f"u/{owner_user_id}/bgm/{uuid4()}.mp3"
    blob_url, upload_url = generate_upload_sas(
        account_name=account,
        account_key=key,
        container=container,
        blob_name=blob_path,
        expiry_minutes=settings.sas_ttl_minutes,
    )
    with httpx.Client(timeout=60.0) as client:
        r = client.put(
            upload_url,
            content=data,
            headers={
                "x-ms-blob-type": "BlockBlob",
                "x-ms-blob-content-type": "audio/mpeg",
            },
        )
        r.raise_for_status()
    return blob_url


def ensure_story_generated_bgm(story_id: str) -> dict[str, Any]:
    """Background-safe: generate + cache unique BGM for a story. Idempotent."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        story = (
            db.query(models.Story)
            .filter(models.Story.id == story_id, models.Story.deleted_at.is_(None))
            .first()
        )
        if not story:
            return {"ok": False, "error": "not_found"}

        existing = story_bgm_url(db, story)
        if existing:
            db.commit()
            return {"ok": True, "cached": True, "bgm_url": existing}

        if not generative_music_available():
            return {"ok": False, "error": "not_configured"}

        track = (story.bgm_track or "").strip().lower()
        if track == "none":
            return {"ok": False, "error": "voice_only"}

        body = (story.story_text or story.summary or "").strip()
        if not body:
            return {"ok": False, "error": "no_text"}

        openai_key = (settings.openai_api_key or "").strip()
        prompt = generate_narrate_music_prompt(
            body,
            openai_key,
            settings.openai_curator_model,
            title=(story.title or ""),
            summary=(story.summary or ""),
        )
        # Bias the bed toward the chosen mood label when present
        if track in TRACK_IDS:
            prompt = f"{prompt} Mood: {track}."

        audio = generate_bgm_audio(
            prompt,
            duration=15,  # short loop — cuts Music credits ~4× vs 60s; client loops
            api_key=settings.elevenlabs_api_key,
        )
        if not audio:
            logger.info("story_curation: generative BGM failed story=%s (quota or API)", story_id)
            return {"ok": False, "error": "generation_failed"}

        blob_url = _upload_bgm_bytes(str(story.owner_user_id), audio)
        if not blob_url:
            return {"ok": False, "error": "upload_failed"}

        asset = models.Asset(
            owner_user_id=story.owner_user_id,
            type="bgm",
            blob_url=blob_url,
            metadata_json={"source": "elevenlabs_music", "story_id": str(story.id), "prompt": prompt[:500]},
        )
        db.add(asset)
        db.flush()

        cache = (
            db.query(models.StoryBgmCache)
            .filter(models.StoryBgmCache.story_id == story.id)
            .first()
        )
        if cache:
            cache.asset_id = asset.id
        else:
            db.add(models.StoryBgmCache(story_id=story.id, asset_id=asset.id))
        story.bgm_asset_id = asset.id
        db.commit()

        url = _bgm_url_for_asset(db, str(asset.id))
        logger.info("story_curation: generative BGM ready story=%s asset=%s", story_id, asset.id)
        return {"ok": True, "cached": False, "bgm_url": url}
    except Exception as e:
        logger.warning("story_curation: ensure_story_generated_bgm failed story=%s err=%s", story_id, e)
        db.rollback()
        return {"ok": False, "error": str(e)[:200]}
    finally:
        db.close()


def story_specific_tts_addon(body_text: str, narration_tone: str | None) -> str:
    """Short per-story color for TTS instructions (unique even when library BGM repeats)."""
    text = (body_text or "").strip()
    if not text:
        return ""
    # Lightweight gist without another model call — first meaningful clause
    snippet = re.sub(r"\s+", " ", text)[:180].strip()
    if len(snippet) < 24:
        return ""
    tone = (narration_tone or "warm").strip().lower() or "warm"
    return (
        f" This story opens around: “{snippet}…”. "
        f"Keep the {tone} style, but shape pacing and emphasis to this specific memory — "
        f"not a generic reading."
    )
