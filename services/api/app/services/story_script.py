"""Derive / upsert the single Story script linked to a Conversation."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.core.openai_models import storyteller_model
from app.db import models
from app.services.ai_recall import generate_story_title
from app.services.openai_chat import chat_text

logger = logging.getLogger(__name__)

DERIVE_SCRIPT_SYSTEM = """You are the Storyteller for LifeBook.
Turn the conversation transcript into a professional first-person story SCRIPT suitable for reading aloud.
Rules:
- Keep the person's meaning and voice; do not invent major facts.
- Structure clearly: gentle opening, a few vivid beats (people, place, feeling), soft closing.
- Use the same language as the transcript.
- Output ONLY the script text — no title line, no markdown, no preamble."""


def conversation_source_text(db: Session, conv: models.Conversation) -> str:
    """Best-effort exact transcript text for derive."""
    transcript = (
        db.query(models.Transcript)
        .filter(models.Transcript.conversation_id == conv.id)
        .order_by(models.Transcript.created_at.asc())
        .first()
    )
    if transcript:
        blob = (transcript.text_en or transcript.text or "").strip()
        if blob:
            return blob
    turns = conv.session_turns_json if isinstance(conv.session_turns_json, list) else []
    lines: list[str] = []
    for t in turns:
        if not isinstance(t, dict):
            continue
        role = (t.get("role") or "").strip()
        content = (t.get("content") or "").strip()
        if content:
            who = "User" if role.lower() in ("user", "human") else "Companion"
            lines.append(f"{who}: {content}")
    return "\n".join(lines).strip()


def find_script_for_conversation(
    db: Session, owner_user_id: str, conversation_id: str
) -> models.Story | None:
    return (
        db.query(models.Story)
        .filter(
            models.Story.owner_user_id == owner_user_id,
            models.Story.source_conversation_id == conversation_id,
            models.Story.deleted_at.is_(None),
        )
        .first()
    )


def derive_script_text(api_key: str, source: str) -> str | None:
    text = (source or "").strip()
    if not text or not api_key:
        return None
    return chat_text(
        api_key=api_key,
        model=storyteller_model(),
        messages=[
            {"role": "system", "content": DERIVE_SCRIPT_SYSTEM},
            {"role": "user", "content": text[:12000]},
        ],
        max_completion_tokens=2500,
        temperature=0.4,
        reasoning_effort="low",
        timeout=60.0,
        log_label="story_script.derive",
    )


def upsert_script_for_conversation(
    db: Session,
    *,
    owner_user_id: str,
    conversation: models.Conversation,
    story_text: str,
    api_key: str = "",
    tags: list[str] | None = None,
) -> models.Story:
    """Create or update the single Script for this conversation."""
    text = (story_text or "").strip()
    if not text:
        raise ValueError("Script text is required.")
    title = generate_story_title(text, api_key) if api_key else None
    if not title:
        title = "Story script"
    tag_list = tags
    if tag_list is None and isinstance(conversation.tags_json, list):
        tag_list = [str(t).strip() for t in conversation.tags_json if str(t).strip()][:10]

    story = find_script_for_conversation(db, owner_user_id, str(conversation.id))
    now = datetime.now(timezone.utc)
    if story:
        story.story_text = text
        story.summary = text[:500]
        story.title = title
        if tag_list is not None:
            story.tags_json = tag_list or None
        story.updated_at = now
    else:
        story = models.Story(
            owner_user_id=owner_user_id,
            source_conversation_id=conversation.id,
            title=title,
            summary=text[:500],
            story_text=text,
            tags_json=tag_list or None,
        )
        db.add(story)
    db.commit()
    db.refresh(story)
    return story
