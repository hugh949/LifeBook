import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db import models
from app.core.config import settings, DEFAULT_FAMILY_ID
from app.services.ai_recall import generate_recall_label
from pydantic import BaseModel

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
    participantId: str | None = None  # Build 2: who was speaking
    turns: list[TurnItem] | None = None  # Build 2: conversation turns for continuity
    keywords: list[str] | None = None  # reminder tags (e.g. from first user message) for recall list
    summary: str | None = None  # one-line summary from conversation (e.g. first user message) for recall list & agent context


@router.post("/complete")
def session_complete(body: SessionCompleteBody, db: Session = Depends(get_db)):
    num_turns = len(body.turns or [])
    logger.info(
        "sessions/complete: audioAssetId=%s participantId=%s turns=%s",
        body.audioAssetId,
        body.participantId,
        num_turns,
    )
    if body.turns:
        roles = [t.role for t in body.turns]
        user_count = sum(1 for r in roles if (r or "").strip().lower() in ("user", "human"))
        logger.info(
            "sessions/complete: [recall-debug] roles=%s user_turns=%s",
            roles[:10],
            user_count,
        )
    try:
        meta = body.sessionMeta or {}
        summary = (
            (body.summary and body.summary.strip())
            or (meta.get("summary") if isinstance(meta, dict) else None)
            or "Session recorded."
        )
        turns_json = None
        if body.turns:
            turns_json = [{"role": t.role, "content": t.content} for t in body.turns]
        tags_json = None
        if body.keywords and isinstance(body.keywords, list):
            tags_json = [str(k).strip() for k in body.keywords if str(k).strip()][:10]  # max 10 reminder tags
        moment = models.Moment(
            family_id=DEFAULT_FAMILY_ID,
            title="Voice session",
            summary=summary,
            source="older_session",
            participant_id=body.participantId,
            session_turns_json=turns_json,
            tags_json=tags_json if tags_json else None,
        )
        db.add(moment)
        db.commit()
        db.refresh(moment)
        if body.audioAssetId:
            db.add(models.MomentAsset(moment_id=moment.id, asset_id=body.audioAssetId, role="session_audio"))
            db.commit()
        # Persist transcript for recall list: from turns (role: content per line) so we can always derive labels
        if body.turns:
            transcript_lines = [f"{t.role}: {t.content}" for t in body.turns if (t.content or "").strip()]
            if transcript_lines:
                transcript_text = "\n".join(transcript_lines)
                db.add(models.Transcript(
                    moment_id=moment.id,
                    asset_id=body.audioAssetId,
                    language="en",
                    text=transcript_text,
                ))
                db.commit()
                logger.info(
                    "sessions/complete: [recall-debug] saved transcript moment_id=%s lines=%s preview=%s",
                    moment.id,
                    len(transcript_lines),
                    (transcript_text[:120] + "…") if len(transcript_text) > 120 else transcript_text,
                )
            else:
                logger.warning("sessions/complete: [recall-debug] turns had no non-empty content, no transcript saved")
            # AI-derived recall label (tags + summary) from participant words only; multilingual-friendly
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
                if ai_summary or ai_tags:
                    moment.summary = ai_summary if ai_summary else moment.summary
                    moment.tags_json = ai_tags if ai_tags else moment.tags_json
                    db.commit()
                    db.refresh(moment)
                    logger.info(
                        "sessions/complete: AI recall moment_id=%s summary=%s tags=%s",
                        moment.id,
                        (ai_summary[:50] + "…") if ai_summary and len(ai_summary) > 50 else ai_summary,
                        ai_tags,
                    )
        else:
            logger.warning("sessions/complete: [recall-debug] no body.turns – session_turns_json and transcript will be empty")
        # Persist transcript so stories and past recordings are searchable and replayable (Azure DB)
        if body.transcriptText or body.transcriptTextEn:
            transcript = models.Transcript(
                moment_id=moment.id,
                asset_id=body.audioAssetId,
                language=body.transcriptLanguage or "en",
                text=(body.transcriptText or "").strip() or None,
                text_en=(body.transcriptTextEn or "").strip() or None,
            )
            db.add(transcript)
            db.commit()
        logger.info("sessions/complete: created momentId=%s", moment.id)
        return {"momentId": str(moment.id), "status": "created"}
    except Exception as e:
        logger.exception("sessions/complete: error %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
