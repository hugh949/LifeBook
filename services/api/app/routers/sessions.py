from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db import models
from app.core.config import DEFAULT_FAMILY_ID
from pydantic import BaseModel

router = APIRouter(prefix="/sessions", tags=["sessions"])


class SessionCompleteBody(BaseModel):
    audioAssetId: str | None = None
    sessionMeta: dict | None = None
    # Preserve voice in shared memory: store transcript in Azure DB for replay and search
    transcriptText: str | None = None
    transcriptLanguage: str | None = None
    transcriptTextEn: str | None = None


@router.post("/complete")
def session_complete(body: SessionCompleteBody, db: Session = Depends(get_db)):
    # Create moment for this voice session (preserved in Azure DB for shared memory)
    moment = models.Moment(
        family_id=DEFAULT_FAMILY_ID,
        title="Voice session",
        summary=body.sessionMeta.get("summary", "Session recorded.") if body.sessionMeta else "Session recorded.",
        source="older_session",
    )
    db.add(moment)
    db.commit()
    db.refresh(moment)
    if body.audioAssetId:
        db.add(models.MomentAsset(moment_id=moment.id, asset_id=body.audioAssetId, role="session_audio"))
        db.commit()
    # Persist transcript so stories and past recordings are searchable and replayable (Azure DB)
    if (body.transcriptText or body.transcriptTextEn):
        transcript = models.Transcript(
            moment_id=moment.id,
            asset_id=body.audioAssetId,
            language=body.transcriptLanguage or "en",
            text=(body.transcriptText or "").strip() or None,
            text_en=(body.transcriptTextEn or "").strip() or None,
        )
        db.add(transcript)
        db.commit()
    return {"momentId": str(moment.id), "status": "created"}
