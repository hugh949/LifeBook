"""Save a voice session as a private Conversation for the current user."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.ai_recall import generate_recall_label


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/sessions", tags=["sessions"])


class TurnItem(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class SessionCompleteBody(BaseModel):
    audioAssetId: str | None = None
    sessionMeta: dict | None = None
    transcriptText: str | None = None
    transcriptLanguage: str | None = None
    transcriptTextEn: str | None = None
    turns: list[TurnItem] | None = None
    keywords: list[str] | None = None
    summary: str | None = None


@router.post("/complete")
def session_complete(
    body: SessionCompleteBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    num_turns = len(body.turns or [])
    logger.info(
        "sessions/complete: user=%s audioAssetId=%s turns=%s",
        current_user.id,
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
        turns_json = None
        if body.turns:
            turns_json = [{"role": t.role, "content": t.content} for t in body.turns]
        tags_json = None
        if body.keywords and isinstance(body.keywords, list):
            tags_json = [str(k).strip() for k in body.keywords if str(k).strip()][:10]

        # Validate that referenced audio asset belongs to the user
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

        conversation = models.Conversation(
            owner_user_id=current_user.id,
            title="Voice conversation",
            summary=summary,
            session_turns_json=turns_json,
            tags_json=tags_json,
            audio_asset_id=audio_asset_id,
            language=body.transcriptLanguage or "en",
        )
        db.add(conversation)
        db.commit()
        db.refresh(conversation)

        # Derive a better summary + tags from participant turns via OpenAI when available
        if body.turns:
            participant_parts = [
                (t.content or "").strip()
                for t in body.turns
                if (t.role or "").strip().lower() in ("user", "human") and (t.content or "").strip()
            ]
            participant_text = " ".join(participant_parts)
            api_key = (settings.openai_api_key or "").strip()
            model = (settings.openai_text_model or "").strip() or "gpt-4o-mini"
            if participant_text and api_key:
                ai_summary, ai_tags = generate_recall_label(participant_text, api_key, model)
                if ai_summary:
                    conversation.summary = ai_summary
                if ai_tags:
                    conversation.tags_json = ai_tags
                if ai_summary or ai_tags:
                    db.commit()
                    db.refresh(conversation)

        if body.transcriptText or body.transcriptTextEn:
            transcript = models.Transcript(
                conversation_id=conversation.id,
                language=body.transcriptLanguage or "en",
                text=(body.transcriptText or "").strip() or None,
                text_en=(body.transcriptTextEn or "").strip() or None,
            )
            db.add(transcript)
            db.commit()
        elif body.turns:
            transcript_lines = [
                f"{t.role}: {t.content}" for t in body.turns if (t.content or "").strip()
            ]
            if transcript_lines:
                db.add(
                    models.Transcript(
                        conversation_id=conversation.id,
                        language="en",
                        text="\n".join(transcript_lines),
                    )
                )
                db.commit()

        logger.info("sessions/complete: created conversationId=%s", conversation.id)
        return {"conversationId": str(conversation.id), "status": "created"}
    except Exception as e:
        logger.exception("sessions/complete: error %s", e)
        raise HTTPException(status_code=500, detail=str(e))
