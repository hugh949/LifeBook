"""Save or continue a voice session as a private Conversation for the current user."""
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.ai_recall import generate_recall_label
from app.services.user_preferences import learn_from_content_job


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])


class TurnItem(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class SessionCompleteBody(BaseModel):
    conversation_id: str | None = None  # append to existing when set
    audioAssetId: str | None = None
    sessionMeta: dict | None = None
    transcriptText: str | None = None
    transcriptLanguage: str | None = None
    transcriptTextEn: str | None = None
    turns: list[TurnItem] | None = None
    keywords: list[str] | None = None
    summary: str | None = None


def _turns_as_json(turns: list[TurnItem] | None) -> list[dict] | None:
    if not turns:
        return None
    return [{"role": t.role, "content": t.content} for t in turns]


def _participant_text(turns: list[TurnItem] | list[dict] | None) -> str:
    if not turns:
        return ""
    parts: list[str] = []
    for t in turns:
        if isinstance(t, dict):
            role = (t.get("role") or "").strip().lower()
            content = (t.get("content") or "").strip()
        else:
            role = (t.role or "").strip().lower()
            content = (t.content or "").strip()
        if content and role in ("user", "human"):
            parts.append(content)
    return " ".join(parts)


def _learn_text_from_turns(turns: list[TurnItem] | None, fallback_summary: str) -> str:
    learn_parts: list[str] = []
    if turns:
        for t in turns:
            role = (t.role or "").strip().lower()
            content = (t.content or "").strip()
            if content and role in ("user", "human", "assistant"):
                who = "User" if role in ("user", "human") else "Assistant"
                learn_parts.append(f"{who}: {content}")
    if not learn_parts and fallback_summary.strip():
        learn_parts.append(fallback_summary.strip())
    return "\n".join(learn_parts).strip()


def _append_or_replace_transcript(
    db: Session,
    conversation_id: str,
    *,
    language: str,
    text: str | None,
    text_en: str | None,
    append_session_text: str | None,
) -> None:
    existing = (
        db.query(models.Transcript)
        .filter(models.Transcript.conversation_id == conversation_id)
        .order_by(models.Transcript.created_at.asc())
        .first()
    )
    if text or text_en:
        new_text = (text or "").strip() or None
        new_en = (text_en or "").strip() or None
        if existing:
            if new_text:
                prev = (existing.text or "").strip()
                existing.text = f"{prev}\n\n{new_text}".strip() if prev else new_text
            if new_en:
                prev_en = (existing.text_en or "").strip()
                existing.text_en = f"{prev_en}\n\n{new_en}".strip() if prev_en else new_en
            existing.language = language
        else:
            db.add(
                models.Transcript(
                    conversation_id=conversation_id,
                    language=language,
                    text=new_text,
                    text_en=new_en,
                )
            )
        return
    if append_session_text:
        if existing:
            prev = (existing.text or "").strip()
            existing.text = (
                f"{prev}\n\n{append_session_text}".strip() if prev else append_session_text
            )
            existing.language = language
        else:
            db.add(
                models.Transcript(
                    conversation_id=conversation_id,
                    language=language,
                    text=append_session_text,
                )
            )


@router.post("/complete")
def session_complete(
    body: SessionCompleteBody,
    background_tasks: BackgroundTasks,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    num_turns = len(body.turns or [])
    resume_id = (body.conversation_id or "").strip() or None
    logger.info(
        "sessions/complete: user=%s resume=%s audioAssetId=%s turns=%s",
        current_user.id,
        resume_id,
        body.audioAssetId,
        num_turns,
    )
    try:
        meta = body.sessionMeta or {}
        summary = (
            (body.summary and body.summary.strip())
            or (meta.get("summary") if isinstance(meta, dict) else None)
            or "Voice conversation."
        )
        new_turns = _turns_as_json(body.turns)
        tags_json = None
        if body.keywords and isinstance(body.keywords, list):
            tags_json = [str(k).strip() for k in body.keywords if str(k).strip()][:10]

        audio_asset_id = None
        if body.audioAssetId:
            asset = (
                db.query(models.Asset)
                .filter(
                    models.Asset.id == body.audioAssetId,
                    models.Asset.owner_user_id == current_user.id,
                )
                .first()
            )
            if asset:
                audio_asset_id = asset.id

        conversation: models.Conversation | None = None
        status = "created"
        if resume_id:
            conversation = (
                db.query(models.Conversation)
                .filter(
                    models.Conversation.id == resume_id,
                    models.Conversation.owner_user_id == current_user.id,
                    models.Conversation.deleted_at.is_(None),
                )
                .first()
            )
            if not conversation:
                raise HTTPException(status_code=404, detail="Conversation not found.")
            status = "updated"
            prev_turns = (
                list(conversation.session_turns_json)
                if isinstance(conversation.session_turns_json, list)
                else []
            )
            if new_turns:
                conversation.session_turns_json = prev_turns + new_turns
            if audio_asset_id:
                conversation.audio_asset_id = audio_asset_id
            if body.transcriptLanguage:
                conversation.language = body.transcriptLanguage
            # Prefer refreshed AI summary over generic placeholder
            if summary and summary != "Voice conversation.":
                conversation.summary = summary
            if tags_json:
                conversation.tags_json = tags_json
            db.commit()
            db.refresh(conversation)
        else:
            conversation = models.Conversation(
                owner_user_id=current_user.id,
                title="Voice conversation",
                summary=summary,
                session_turns_json=new_turns,
                tags_json=tags_json,
                audio_asset_id=audio_asset_id,
                language=body.transcriptLanguage or "en",
            )
            db.add(conversation)
            db.commit()
            db.refresh(conversation)

        # AI recall from full participant text (all turns after append)
        all_turns = (
            conversation.session_turns_json
            if isinstance(conversation.session_turns_json, list)
            else []
        )
        participant_text = _participant_text(all_turns)
        api_key = (settings.openai_api_key or "").strip()
        if participant_text and api_key:
            ai_summary, ai_tags = generate_recall_label(participant_text, api_key)
            if ai_summary:
                conversation.summary = ai_summary
            if ai_tags:
                conversation.tags_json = ai_tags
            if ai_summary or ai_tags:
                db.commit()
                db.refresh(conversation)

        session_transcript = None
        if body.turns:
            lines = [f"{t.role}: {t.content}" for t in body.turns if (t.content or "").strip()]
            if lines:
                session_transcript = "\n".join(lines)

        _append_or_replace_transcript(
            db,
            str(conversation.id),
            language=body.transcriptLanguage or conversation.language or "en",
            text=(body.transcriptText or "").strip() or None,
            text_en=(body.transcriptTextEn or "").strip() or None,
            append_session_text=session_transcript if not (body.transcriptText or body.transcriptTextEn) else None,
        )
        db.commit()

        learn_text = _learn_text_from_turns(body.turns, summary)
        if learn_text and api_key:
            background_tasks.add_task(
                learn_from_content_job,
                str(current_user.id),
                learn_text,
                "conversation",
                api_key,
            )

        logger.info(
            "sessions/complete: %s conversationId=%s",
            status,
            conversation.id,
        )
        return {"conversationId": str(conversation.id), "status": status}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("sessions/complete: error %s", e)
        raise HTTPException(status_code=500, detail=str(e))
