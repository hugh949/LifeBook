"""Shared OpenAI Chat Completions helper (GPT-5.6-safe).

GPT-5 family rejects ``max_tokens`` and non-default ``temperature``. Short
agent tasks use ``reasoning_effort: none`` (or low) so latency stays low.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

CHAT_URL = "https://api.openai.com/v1/chat/completions"


def _is_reasoning_family(model: str) -> bool:
    m = (model or "").strip().lower()
    return (
        m.startswith("gpt-5")
        or m.startswith("o1")
        or m.startswith("o3")
        or m.startswith("o4")
    )


def build_chat_payload(
    *,
    model: str,
    messages: list[dict[str, Any]],
    max_completion_tokens: int,
    temperature: float | None = 0.3,
    reasoning_effort: str | None = "none",
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": (model or "").strip(),
        "messages": messages,
    }
    if _is_reasoning_family(payload["model"]):
        # Budget must cover hidden reasoning tokens + visible output.
        payload["max_completion_tokens"] = max(max_completion_tokens, 256)
        if reasoning_effort:
            payload["reasoning_effort"] = reasoning_effort
    else:
        payload["max_tokens"] = max_completion_tokens
        if temperature is not None:
            payload["temperature"] = temperature
    return payload


def chat_text(
    *,
    api_key: str,
    model: str,
    messages: list[dict[str, Any]],
    max_completion_tokens: int,
    temperature: float | None = 0.3,
    reasoning_effort: str | None = "none",
    timeout: float = 20.0,
    log_label: str = "openai_chat",
) -> str | None:
    """POST /v1/chat/completions and return assistant message content, or None."""
    key = (api_key or "").strip()
    m = (model or "").strip()
    if not key or not m:
        return None
    payload = build_chat_payload(
        model=m,
        messages=messages,
        max_completion_tokens=max_completion_tokens,
        temperature=temperature,
        reasoning_effort=reasoning_effort,
    )
    try:
        with httpx.Client() as client:
            r = client.post(
                CHAT_URL,
                headers={
                    "Authorization": f"Bearer {key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout,
            )
        r.raise_for_status()
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if not choice:
            return None
        content = (choice.get("message") or {}).get("content") or ""
        content = content.strip()
        return content or None
    except Exception as e:
        logger.warning("%s: OpenAI chat failed: %s", log_label, e)
        return None
