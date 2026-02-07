import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import and_
from app.db.session import get_db
from app.db import models
from app.core.config import DEFAULT_FAMILY_ID, settings
from app.core.azure_storage import signed_read_url
from app.schemas.moment import MomentCreate, MomentPatch

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/moments", tags=["moments"])


def _sign_display_urls(thumb_url: str | None, image_url: str | None) -> tuple[str | None, str | None]:
    """Return signed read URLs for Azure blobs so the frontend can display them."""
    if not settings.azure_storage_account_key:
        return thumb_url, image_url
    ttl = getattr(settings, "read_sas_ttl_minutes", 60)
    thumb = signed_read_url(thumb_url, settings.azure_storage_account_key, ttl) if thumb_url else None
    img = signed_read_url(image_url, settings.azure_storage_account_key, ttl) if image_url else None
    return thumb, img


def _first_photo_urls(db: Session, moment_id: str) -> tuple[str | None, str | None]:
    """Return (thumb_url, image_url) for the first photo asset linked to this moment."""
    row = (
        db.query(models.Asset.thumb_url, models.Asset.blob_url)
        .join(models.MomentAsset, models.MomentAsset.asset_id == models.Asset.id)
        .where(
            and_(
                models.MomentAsset.moment_id == moment_id,
                models.Asset.type == "photo",
            )
        )
        .limit(1)
        .first()
    )
    if not row:
        return None, None
    thumb, blob = row[0], row[1]
    return (thumb or blob), blob


def _moment_to_response(m, thumb_url: str | None = None, image_url: str | None = None, assets: list | None = None, transcripts: list | None = None):
    """Serialize Moment ORM to dict for JSON; avoid UUID/datetime serialization issues."""
    out = {
        "id": str(m.id),
        "family_id": str(m.family_id),
        "title": m.title,
        "summary": m.summary,
        "language": m.language,
        "tags_json": m.tags_json,
        "source": m.source,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }
    if thumb_url is not None:
        out["thumbnail_url"] = thumb_url
    if image_url is not None:
        out["image_url"] = image_url
    if assets is not None:
        out["assets"] = assets
    if transcripts is not None:
        out["transcripts"] = transcripts
    return out


def _sign_asset_url(blob_url: str | None) -> str | None:
    """Return signed read URL for an asset blob, or None if not Azure/stub."""
    if not blob_url or not settings.azure_storage_account_key:
        return blob_url
    ttl = getattr(settings, "read_sas_ttl_minutes", 60)
    return signed_read_url(blob_url, settings.azure_storage_account_key, ttl)


@router.get("")
def list_moments(
    personId: str | None = None,
    q: str | None = None,
    from_: str | None = None,
    to: str | None = None,
    db: Session = Depends(get_db),
):
    try:
        query = db.query(models.Moment).filter(models.Moment.family_id == DEFAULT_FAMILY_ID)
        if q:
            query = query.filter(
                (models.Moment.title.ilike(f"%{q}%")) | (models.Moment.summary.ilike(f"%{q}%"))
            )
        moments = query.order_by(models.Moment.created_at.desc()).limit(50).all()
        # Attach first photo thumbnail/image URL per moment
        photo_map = {}
        if moments:
            moment_ids = [str(m.id) for m in moments]
            rows = (
                db.query(models.MomentAsset.moment_id, models.Asset.thumb_url, models.Asset.blob_url)
                .join(models.Asset, models.MomentAsset.asset_id == models.Asset.id)
                .where(
                    models.MomentAsset.moment_id.in_(moment_ids),
                    models.Asset.type == "photo",
                )
            )
            for row in rows:
                mid = str(row.moment_id)
                if mid not in photo_map:
                    thumb, blob = row.thumb_url, row.blob_url
                    photo_map[mid] = (thumb or blob, blob)
        out = []
        for m in moments:
            raw_thumb, raw_img = photo_map.get(str(m.id), (None, None))
            thumb_url, image_url = _sign_display_urls(raw_thumb, raw_img)
            out.append(_moment_to_response(m, thumb_url=thumb_url, image_url=image_url))
        return out
    except Exception as e:
        logger.exception("list_moments error")
        raise HTTPException(status_code=500, detail=str(e))


def _load_moment_assets(db: Session, moment_id: str) -> list[dict]:
    """Load all assets linked to this moment with signed URLs for playback/display (shared memory)."""
    rows = (
        db.query(models.MomentAsset.role, models.Asset)
        .join(models.Asset, models.MomentAsset.asset_id == models.Asset.id)
        .where(models.MomentAsset.moment_id == moment_id)
        .order_by(models.MomentAsset.asset_id)
    ).all()
    out = []
    for role, asset in rows:
        a = {
            "id": str(asset.id),
            "type": asset.type,
            "role": role,
            "duration_sec": asset.duration_sec,
            "created_at": asset.created_at.isoformat() if asset.created_at else None,
        }
        if asset.type == "photo":
            thumb = asset.thumb_url or asset.blob_url
            a["thumbnail_url"] = _sign_asset_url(thumb) if thumb else None
            a["image_url"] = _sign_asset_url(asset.blob_url)
        else:
            a["playback_url"] = _sign_asset_url(asset.blob_url)
        out.append(a)
    return out


def _load_moment_transcripts(db: Session, moment_id: str) -> list[dict]:
    """Load all transcripts for this moment (voice sessions, voice notes)."""
    rows = (
        db.query(models.Transcript)
        .where(models.Transcript.moment_id == moment_id)
        .order_by(models.Transcript.created_at)
    ).all()
    return [
        {
            "id": str(t.id),
            "asset_id": str(t.asset_id) if t.asset_id else None,
            "language": t.language,
            "text": t.text,
            "text_en": t.text_en,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        }
        for t in rows
    ]


@router.get("/{moment_id}")
def get_moment(moment_id: str, db: Session = Depends(get_db)):
    try:
        moment = (
            db.query(models.Moment)
            .filter(models.Moment.id == moment_id, models.Moment.family_id == DEFAULT_FAMILY_ID)
            .first()
        )
        if not moment:
            raise HTTPException(status_code=404, detail="Moment not found")
        raw_thumb, raw_img = _first_photo_urls(db, moment_id)
        thumb_url, image_url = _sign_display_urls(raw_thumb, raw_img)
        assets = _load_moment_assets(db, moment_id)
        transcripts = _load_moment_transcripts(db, moment_id)
        return _moment_to_response(
            moment, thumb_url=thumb_url, image_url=image_url, assets=assets, transcripts=transcripts
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("get_moment error")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("", status_code=201)
def create_moment(body: MomentCreate, db: Session = Depends(get_db)):
    try:
        moment = models.Moment(
            family_id=DEFAULT_FAMILY_ID,
            title=body.title or "",
            summary=body.summary,
            language=body.language,
            tags_json=body.tags_json,
            source=body.source,
        )
        db.add(moment)
        db.commit()
        db.refresh(moment)
        if body.asset_ids:
            for aid in body.asset_ids:
                link = models.MomentAsset(moment_id=moment.id, asset_id=aid, role="hero")
                db.add(link)
            db.commit()
            db.refresh(moment)
        raw_thumb, raw_img = _first_photo_urls(db, str(moment.id))
        thumb_url, image_url = _sign_display_urls(raw_thumb, raw_img)
        return _moment_to_response(moment, thumb_url=thumb_url, image_url=image_url)
    except Exception as e:
        logger.exception("create_moment error")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{moment_id}")
def patch_moment(moment_id: str, body: MomentPatch, db: Session = Depends(get_db)):
    try:
        moment = (
            db.query(models.Moment)
            .filter(models.Moment.id == moment_id, models.Moment.family_id == DEFAULT_FAMILY_ID)
            .first()
        )
        if not moment:
            raise HTTPException(status_code=404, detail="Moment not found")
        if body.add_comment and body.add_comment.strip():
            existing = (moment.summary or "").strip()
            moment.summary = f"{existing}\n\n{body.add_comment.strip()}" if existing else body.add_comment.strip()
        if body.title is not None:
            moment.title = body.title
        if body.summary is not None:
            moment.summary = body.summary
        db.commit()
        db.refresh(moment)
        raw_thumb, raw_img = _first_photo_urls(db, moment_id)
        thumb_url, image_url = _sign_display_urls(raw_thumb, raw_img)
        return _moment_to_response(moment, thumb_url=thumb_url, image_url=image_url)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("patch_moment error")
        raise HTTPException(status_code=500, detail=str(e))
