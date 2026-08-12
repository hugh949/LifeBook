"""Chief-of-Staff preference store + automatic learning loop.

Prefs live in ``user_preferences.prefs_json``. Structured fields plus a readable
``learned_summary`` are injected into Conversation / Storyteller / Curator packs.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.core.openai_models import chief_of_staff_model
from app.db import models
from app.services.openai_chat import chat_text

logger = logging.getLogger(__name__)

_SCALAR_KEYS = (
    "tone",
    "story_length",
    "topics_to_avoid",
    "language",
    "preferred_bgm",
    "notes",
)
_BGM_OK = frozenset({"none", "neutral", "warm", "reflective", "nostalgic"})

LEARN_SYSTEM = """You are LifeBook's Chief-of-Staff. Extract durable USER PREFERENCES so Conversation and Storyteller personalize over time without the person re-explaining.

Return JSON only (no markdown):
{
  "tone": "short phrase or null",
  "story_length": "short|medium|long or null",
  "topics_to_avoid": "comma-separated topics or null",
  "language": "preferred language name or null",
  "themes": ["recurring life themes worth remembering"],
  "preferred_bgm": "none|neutral|warm|reflective|nostalgic or null",
  "learned_summary": "2-4 sentences: private summary of how to talk with this person and what matters to them",
  "learned_items": ["short durable preference bullets"]
}

Rules:
- Prefer interaction style (tone, length, topics to avoid, language) and recurring themes — not one-off plot facts.
- Merge with EXISTING prefs: refine and accumulate; do not discard prior learning unless new evidence clearly supersedes.
- Never reintroduce anything listed under DISMISSED.
- If signal is weak, keep existing fields and only lightly update learned_summary / learned_items.
- Keep privacy: no third-party secrets; write as if only the owner will read this."""


def get_or_create_prefs(db: Session, user_id: str) -> models.UserPreferences:
    row = db.query(models.UserPreferences).filter(models.UserPreferences.user_id == user_id).first()
    if row:
        return row
    row = models.UserPreferences(user_id=user_id, prefs_json={})
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _as_dict(row: models.UserPreferences | None) -> dict[str, Any]:
    if not row or not isinstance(row.prefs_json, dict):
        return {}
    return dict(row.prefs_json)


def _normalize_item_text(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _dismissed_set(prefs: dict[str, Any]) -> set[str]:
    raw = prefs.get("dismissed")
    if not isinstance(raw, list):
        return set()
    out: set[str] = set()
    for d in raw:
        if isinstance(d, str) and d.strip():
            out.add(_normalize_item_text(d))
        elif isinstance(d, dict) and d.get("text"):
            out.add(_normalize_item_text(str(d["text"])))
    return out


def _parse_learn_json(raw: str) -> dict[str, Any] | None:
    text = (raw or "").strip()
    if not text:
        return None
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{[\s\S]*\}", text)
        if not m:
            return None
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return None
    return data if isinstance(data, dict) else None


def _merge_learned(
    existing: dict[str, Any],
    extracted: dict[str, Any],
    *,
    source: str,
) -> dict[str, Any]:
    prefs = dict(existing)
    dismissed = _dismissed_set(prefs)
    now = datetime.now(timezone.utc).isoformat()

    for key in ("tone", "story_length", "topics_to_avoid", "language"):
        val = extracted.get(key)
        if isinstance(val, str) and val.strip() and val.strip().lower() not in ("null", "none"):
            prefs[key] = val.strip()[:200]

    bgm = extracted.get("preferred_bgm")
    if isinstance(bgm, str) and bgm.strip().lower() in _BGM_OK:
        prefs["preferred_bgm"] = bgm.strip().lower()

    themes_in = extracted.get("themes")
    themes: list[str] = []
    if isinstance(prefs.get("themes"), list):
        themes = [str(t).strip() for t in prefs["themes"] if str(t).strip()]
    if isinstance(themes_in, list):
        for t in themes_in:
            s = str(t).strip()
            if not s or _normalize_item_text(s) in dismissed:
                continue
            if s not in themes:
                themes.append(s)
    prefs["themes"] = themes[:12]

    summary = extracted.get("learned_summary")
    if isinstance(summary, str) and summary.strip():
        prefs["learned_summary"] = summary.strip()[:1200]

    items: list[dict[str, Any]] = []
    prior = prefs.get("learned_items")
    if isinstance(prior, list):
        for it in prior:
            if isinstance(it, dict) and it.get("text"):
                items.append(it)
            elif isinstance(it, str) and it.strip():
                items.append({"id": uuid.uuid4().hex[:12], "text": it.strip(), "source": "legacy", "at": now})

    seen = {_normalize_item_text(str(it.get("text") or "")) for it in items}
    new_items = extracted.get("learned_items")
    if isinstance(new_items, list):
        for raw in new_items:
            text = str(raw).strip() if not isinstance(raw, dict) else str(raw.get("text") or "").strip()
            if not text:
                continue
            norm = _normalize_item_text(text)
            if not norm or norm in dismissed or norm in seen:
                continue
            items.append(
                {
                    "id": uuid.uuid4().hex[:12],
                    "text": text[:280],
                    "source": source,
                    "at": now,
                }
            )
            seen.add(norm)
    prefs["learned_items"] = items[-24:]
    prefs["last_learned_at"] = now
    prefs["last_learned_source"] = source
    return prefs


def learn_from_content(
    db: Session,
    user_id: str,
    *,
    content: str,
    source: str,
    api_key: str,
) -> dict[str, Any] | None:
    """Extract preference signals from new conversation/story text and merge into prefs.

    Soft-fails (returns None) when API key/content missing or the model call fails.
    """
    text = (content or "").strip()
    key = (api_key or "").strip()
    if not text or not key:
        return None
    if len(text) < 40:
        return None

    row = get_or_create_prefs(db, user_id)
    existing = _as_dict(row)
    dismissed = existing.get("dismissed") if isinstance(existing.get("dismissed"), list) else []

    existing_brief = {
        k: existing.get(k)
        for k in (
            "tone",
            "story_length",
            "topics_to_avoid",
            "language",
            "themes",
            "preferred_bgm",
            "learned_summary",
            "learned_items",
            "notes",
        )
        if existing.get(k) not in (None, "", [], {})
    }

    user_msg = (
        f"SOURCE: {source}\n\n"
        f"EXISTING prefs:\n{json.dumps(existing_brief, ensure_ascii=False)[:3500]}\n\n"
        f"DISMISSED (do not reintroduce):\n{json.dumps(dismissed, ensure_ascii=False)[:1500]}\n\n"
        f"NEW content:\n{text[:7000]}"
    )

    raw = chat_text(
        api_key=key,
        model=chief_of_staff_model(),
        messages=[
            {"role": "system", "content": LEARN_SYSTEM},
            {"role": "user", "content": user_msg},
        ],
        max_completion_tokens=700,
        temperature=0.2,
        reasoning_effort="none",
        timeout=25.0,
        log_label="user_preferences.learn_from_content",
    )
    if not raw:
        return None
    extracted = _parse_learn_json(raw)
    if not extracted:
        logger.warning("user_preferences: could not parse learn JSON")
        return None

    merged = _merge_learned(existing, extracted, source=source)
    row.prefs_json = merged
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    logger.info(
        "user_preferences: learned from %s for user=%s items=%s",
        source,
        user_id,
        len(merged.get("learned_items") or []),
    )
    return merged if isinstance(row.prefs_json, dict) else merged


def learn_from_content_job(user_id: str, content: str, source: str, api_key: str) -> None:
    """Background-safe wrapper with its own DB session."""
    from app.db.session import SessionLocal

    db = SessionLocal()
    try:
        learn_from_content(db, user_id, content=content, source=source, api_key=api_key)
    except Exception as e:
        logger.warning("user_preferences background learn failed: %s", e)
    finally:
        db.close()


def dismiss_learned_item(prefs: dict[str, Any], *, item_id: str | None = None, text: str | None = None) -> dict[str, Any]:
    """Remove one learned item and remember it as dismissed so learning won't reinstate it."""
    out = dict(prefs)
    items = out.get("learned_items")
    if not isinstance(items, list):
        items = []
    dismiss_norm: str | None = None
    kept: list[Any] = []
    for it in items:
        if isinstance(it, dict):
            match_id = item_id and str(it.get("id") or "") == item_id
            match_text = text and _normalize_item_text(str(it.get("text") or "")) == _normalize_item_text(text)
            if match_id or match_text:
                dismiss_norm = _normalize_item_text(str(it.get("text") or ""))
                continue
            kept.append(it)
        elif isinstance(it, str):
            if text and _normalize_item_text(it) == _normalize_item_text(text):
                dismiss_norm = _normalize_item_text(it)
                continue
            kept.append(it)
        else:
            kept.append(it)
    out["learned_items"] = kept

    if text and not dismiss_norm:
        dismiss_norm = _normalize_item_text(text)

    dismissed = out.get("dismissed")
    if not isinstance(dismissed, list):
        dismissed = []
    if dismiss_norm:
        if dismiss_norm not in [_normalize_item_text(str(d) if not isinstance(d, dict) else str(d.get("text") or "")) for d in dismissed]:
            dismissed.append({"text": (text or dismiss_norm)[:280], "at": datetime.now(timezone.utc).isoformat()})
    out["dismissed"] = dismissed[-60:]

    # Drop matching theme if they dismissed a theme-like item
    if dismiss_norm and isinstance(out.get("themes"), list):
        out["themes"] = [t for t in out["themes"] if _normalize_item_text(str(t)) != dismiss_norm]

    return out


def reset_prefs() -> dict[str, Any]:
    return {}


def preference_notes_for_prompt(db: Session, user_id: str) -> str | None:
    try:
        row = db.query(models.UserPreferences).filter(models.UserPreferences.user_id == user_id).first()
    except Exception:
        return None
    if not row or not isinstance(row.prefs_json, dict):
        return None
    prefs = row.prefs_json
    lines: list[str] = []

    summary = prefs.get("learned_summary")
    if isinstance(summary, str) and summary.strip():
        lines.append(f"- Learned about this person: {summary.strip()}")

    if prefs.get("tone"):
        lines.append(f"- Preferred tone: {prefs['tone']}")
    if prefs.get("story_length"):
        lines.append(f"- Preferred story length: {prefs['story_length']}")
    if prefs.get("language"):
        lines.append(f"- Preferred language: {prefs['language']}")
    if prefs.get("topics_to_avoid"):
        lines.append(f"- Topics to treat gently or avoid: {prefs['topics_to_avoid']}")
    if prefs.get("dont_offer_sharing"):
        lines.append("- Never offer or mention sharing with others.")
    if prefs.get("preferred_bgm"):
        lines.append(f"- Preferred background music mood: {prefs['preferred_bgm']}")

    themes = prefs.get("themes")
    if isinstance(themes, list) and themes:
        clean = [str(t).strip() for t in themes if str(t).strip()][:10]
        if clean:
            lines.append(f"- Recurring themes: {', '.join(clean)}")

    learned_items = prefs.get("learned_items")
    if isinstance(learned_items, list) and learned_items:
        for it in learned_items[-10:]:
            if isinstance(it, dict) and it.get("text"):
                lines.append(f"- Remember: {str(it['text']).strip()}")
            elif isinstance(it, str) and it.strip():
                lines.append(f"- Remember: {it.strip()}")

    corrections = prefs.get("corrections")
    if isinstance(corrections, list) and corrections:
        for c in corrections[-8:]:
            if isinstance(c, str) and c.strip():
                lines.append(f"- Correction: {c.strip()}")
            elif isinstance(c, dict) and c.get("text"):
                kind = c.get("kind") or "correction"
                label = "Note" if kind == "remember" else "Correction"
                lines.append(f"- {label}: {str(c['text']).strip()}")

    notes = prefs.get("notes")
    if isinstance(notes, str) and notes.strip():
        lines.append(f"- Other notes: {notes.strip()}")

    return "\n".join(lines) if lines else None


def prefs_have_content(prefs: dict[str, Any] | None) -> bool:
    if not prefs:
        return False
    if isinstance(prefs.get("learned_summary"), str) and prefs["learned_summary"].strip():
        return True
    if isinstance(prefs.get("learned_items"), list) and prefs["learned_items"]:
        return True
    if isinstance(prefs.get("themes"), list) and prefs["themes"]:
        return True
    if isinstance(prefs.get("corrections"), list) and prefs["corrections"]:
        return True
    for k in _SCALAR_KEYS:
        v = prefs.get(k)
        if isinstance(v, str) and v.strip():
            return True
        if isinstance(v, bool) and v:
            return True
    return False
