"""Per-agent OpenAI model defaults and resolvers.

Voice agents 1–3 share one Realtime WebRTC session (one model). Text brains
and TTS use role-specific models so Storyteller quality, Curator mood pick,
and Content Manager labeling can be tuned independently.
"""
from __future__ import annotations

import os

# Defaults — latest strong / balanced / efficient tiers (Aug 2026).
DEFAULT_REALTIME = "gpt-realtime-2.1"  # Agent 1 Conversation (also voice shell for 2–3)
DEFAULT_STORYTELLER = "gpt-5.6"  # Agent 2 titles / story craft text
DEFAULT_CURATOR = "gpt-5.6-terra"  # Agent 3 BGM / music prompts (balance quality vs cost)
DEFAULT_CURATOR_TTS = "gpt-4o-mini-tts"  # Agent 3 OpenAI TTS fallback
DEFAULT_CONTENT_MANAGER = "gpt-5.6-luna"  # Agent 4 light library labels/tags
DEFAULT_CHIEF_OF_STAFF = "gpt-5.6-terra"  # Agent 5 prefs/routing text (when used)
DEFAULT_TEXT_FALLBACK = "gpt-5.6-terra"  # OPENAI_TEXT_MODEL when role unset


def _env(*names: str) -> str:
    for name in names:
        v = (os.getenv(name) or "").strip()
        if v:
            return v
    return ""


def _chain(*candidates: str, default: str) -> str:
    for c in candidates:
        v = (c or "").strip()
        if v:
            return v
    return default


def text_fallback() -> str:
    """Global text override used when a role-specific env is empty."""
    return _env("OPENAI_TEXT_MODEL") or DEFAULT_TEXT_FALLBACK


def realtime_model(override: str | None = None) -> str:
    """Agent 1 Conversation — Realtime speech-to-speech."""
    return _chain(override, _env("OPENAI_REALTIME_MODEL"), default=DEFAULT_REALTIME)


def storyteller_model(override: str | None = None) -> str:
    """Agent 2 Storyteller — titles and story-craft text."""
    return _chain(
        override,
        _env("OPENAI_STORYTELLER_MODEL"),
        _env("OPENAI_TEXT_MODEL"),
        default=DEFAULT_STORYTELLER,
    )


def curator_model(override: str | None = None) -> str:
    """Agent 3 Curator — BGM mood / music prompt text."""
    return _chain(
        override,
        _env("OPENAI_CURATOR_MODEL"),
        _env("OPENAI_TEXT_MODEL"),
        default=DEFAULT_CURATOR,
    )


def curator_tts_model(override: str | None = None) -> str:
    """Agent 3 Curator — OpenAI TTS when ElevenLabs clone is unavailable."""
    return _chain(
        override,
        _env("OPENAI_CURATOR_TTS_MODEL", "OPENAI_TTS_MODEL"),
        default=DEFAULT_CURATOR_TTS,
    )


def content_manager_model(override: str | None = None) -> str:
    """Agent 4 Content Manager — recall labels, tags, light inventory text."""
    return _chain(
        override,
        _env("OPENAI_CONTENT_MANAGER_MODEL"),
        _env("OPENAI_TEXT_MODEL"),
        default=DEFAULT_CONTENT_MANAGER,
    )


def chief_of_staff_model(override: str | None = None) -> str:
    """Agent 5 Chief-of-Staff — preference / routing text when an LLM is used."""
    return _chain(
        override,
        _env("OPENAI_CHIEF_OF_STAFF_MODEL"),
        _env("OPENAI_TEXT_MODEL"),
        default=DEFAULT_CHIEF_OF_STAFF,
    )
