"""Pilot: pick a gentle static BGM loop id for shared narration (no extra paid APIs).

Loops live in ``apps/web/public/bgm/{id}.mp3`` (synthetic, ffmpeg-generated, ~-18 LUFS).
Client plays them under narration (dual ``<audio>``); they are not mixed server-side.
Uses heuristics always; optionally refines with one OpenAI call when
``OPENAI_API_KEY`` is set (same key as the rest of the app).
"""
from __future__ import annotations

import re
from typing import Literal

from app.core.openai_models import curator_model
from app.services.openai_chat import chat_text

BgmTrackId = Literal["neutral", "warm", "reflective", "nostalgic"]
TRACK_IDS: frozenset[str] = frozenset({"neutral", "warm", "reflective", "nostalgic"})


def _heuristic_track(blob: str) -> BgmTrackId:
    low = blob.lower()
    if re.search(r"\b(19[3-9]\d|20[0-2]\d)\b", low):
        return "nostalgic"
    if any(
        p in low
        for p in (
            "childhood",
            "when i was young",
            "when we were young",
            "grandmother",
            "grandfather",
            "grandma",
            "grandpa",
            "remember when",
            "used to",
            "those days",
            "years ago",
            "back then",
        )
    ):
        return "nostalgic"
    if any(
        p in low
        for p in (
            "grief",
            "passed away",
            "loss",
            " died",
            "miss you",
            "lonely",
            "hard time",
            "difficult time",
            "regret",
        )
    ):
        return "reflective"
    if any(
        p in low
        for p in (
            "wedding",
            "married",
            "baby",
            "born",
            "celebration",
            "joy",
            "grateful",
            "proud",
            "love you",
            "happy",
            "blessed",
        )
    ):
        return "warm"
    return "neutral"


def _openai_track(blob: str, api_key: str, model: str = "") -> BgmTrackId | None:
    """Curator (Agent 3) mood pick for share BGM."""
    text = chat_text(
        api_key=api_key,
        model=curator_model(model),
        messages=[
            {
                "role": "system",
                "content": (
                    "You choose one background mood for gentle instrumental music under a spoken story. "
                    "Reply with exactly one lowercase word from: neutral, warm, reflective, nostalgic. "
                    "nostalgic: clear past era, childhood, or reminiscence of long ago. "
                    "warm: joy, love, celebration, gratitude. "
                    "reflective: loss, grief, contemplation, hardship. "
                    "neutral: unclear, mixed, or everyday chat."
                ),
            },
            {"role": "user", "content": blob[:4000]},
        ],
        max_completion_tokens=64,
        temperature=0.2,
        reasoning_effort="none",
        timeout=12.0,
        log_label="share_bgm_track",
    )
    if not text:
        return None
    low = text.strip().lower()
    word = re.split(r"\s+", low)[0] if low else ""
    word = re.sub(r"[^a-z]", "", word)
    if word in TRACK_IDS:
        return word  # type: ignore[return-value]
    return None


def pick_share_bgm_track(
    body_text: str,
    title: str | None,
    summary: str | None,
    *,
    openai_api_key: str,
    model: str = "",
) -> BgmTrackId:
    parts = [title or "", summary or "", (body_text or "")[:4000]]
    blob = "\n\n".join(p.strip() for p in parts if p and p.strip()).strip()
    if not blob:
        return "neutral"

    key = (openai_api_key or "").strip()
    if key:
        ai = _openai_track(blob, key, model)
        if ai:
            return ai
    return _heuristic_track(blob)
