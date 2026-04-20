"""Avatar endpoints: upload a selfie, stylize it into a pencil-sketch portrait
with OpenAI Images (gpt-image-1), and serve the signed result.
"""
from __future__ import annotations

import base64
import io
import logging
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.azure_storage import generate_upload_sas, signed_read_url
from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/me/avatar", tags=["me_avatar"])


OPENAI_IMAGE_EDIT_URL = "https://api.openai.com/v1/images/edits"
OPENAI_IMAGE_MODEL = "gpt-image-1"
PENCIL_PROMPT = (
    "A clean black-and-white pencil-sketch cartoon portrait of the person in this "
    "photo. Head and shoulders, soft shading, textured pencil strokes, plain white "
    "background, friendly warm expression. Keep the person's likeness recognizable."
)
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB cap


class AvatarStatusOut(BaseModel):
    status: str  # none | pencilizing | ready | failed
    original_url: str | None = None
    pencil_url: str | None = None
    error: str | None = None


def _ensure_avatar(db: Session, user_id: str) -> models.UserAvatar:
    row = db.query(models.UserAvatar).filter(models.UserAvatar.user_id == user_id).first()
    if not row:
        row = models.UserAvatar(user_id=user_id)
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def _signed(url: str | None) -> str | None:
    if not url:
        return None
    key = (settings.azure_storage_account_key or "").strip()
    if not key:
        return url
    return signed_read_url(url, key, getattr(settings, "read_sas_ttl_minutes", 60))


def _to_status(row: models.UserAvatar) -> AvatarStatusOut:
    return AvatarStatusOut(
        status=row.status or "none",
        original_url=_signed(row.original_photo_blob_url),
        pencil_url=_signed(row.pencil_blob_url),
        error=row.error or None,
    )


@router.get("", response_model=AvatarStatusOut)
def get_avatar(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _ensure_avatar(db, str(current_user.id))
    return _to_status(row)


def _upload_blob(owner_user_id: str, data: bytes, suffix: str, content_type: str) -> str:
    """Upload bytes to Azure (or return stub URL)."""
    account = (settings.azure_storage_account or "").strip()
    key = (settings.azure_storage_account_key or "").strip()
    container = settings.photos_container or "photos"
    blob_path = f"u/{owner_user_id}/avatars/{uuid4()}{suffix}"
    if account and key:
        blob_url, upload_url = generate_upload_sas(
            account_name=account,
            account_key=key,
            container=container,
            blob_name=blob_path,
            expiry_minutes=settings.sas_ttl_minutes,
        )
        with httpx.Client(timeout=30.0) as client:
            r = client.put(
                upload_url,
                content=data,
                headers={
                    "x-ms-blob-type": "BlockBlob",
                    "x-ms-blob-content-type": content_type,
                },
            )
            r.raise_for_status()
        return blob_url
    return f"https://local-mvp/lifebook/{blob_path}"


@router.post("", response_model=AvatarStatusOut)
async def upload_avatar(
    photo: UploadFile = File(..., description="Selfie (JPEG or PNG)"),
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Upload a selfie and synchronously produce the pencil-sketch portrait."""
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="Image generation is not configured on this server.")

    try:
        raw = await photo.read()
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read image.")
    if not raw:
        raise HTTPException(status_code=400, detail="Image is empty.")
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="Image too large; please use a file under 10 MB.")

    content_type = (getattr(photo, "content_type", None) or "image/jpeg").lower()
    if "png" in content_type:
        suffix = ".png"
    elif "jpeg" in content_type or "jpg" in content_type:
        suffix = ".jpg"
    else:
        content_type = "image/jpeg"
        suffix = ".jpg"

    row = _ensure_avatar(db, str(current_user.id))
    row.status = "pencilizing"
    row.error = None
    db.commit()

    try:
        original_url = _upload_blob(str(current_user.id), raw, suffix, content_type)
    except Exception as e:
        logger.exception("me/avatar: upload original failed: %s", e)
        row.status = "failed"
        row.error = "Could not save your photo. Please try again."
        db.commit()
        raise HTTPException(status_code=502, detail=row.error)

    row.original_photo_blob_url = original_url
    db.commit()

    # Call OpenAI Images: edit preserves likeness
    try:
        with httpx.Client(timeout=120.0) as client:
            r = client.post(
                OPENAI_IMAGE_EDIT_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                files={"image[]": ("selfie" + suffix, raw, content_type)},
                data={
                    "model": OPENAI_IMAGE_MODEL,
                    "prompt": PENCIL_PROMPT,
                    "size": "1024x1024",
                    "n": "1",
                },
            )
        r.raise_for_status()
        data = r.json()
        image_b64 = None
        for item in (data.get("data") or []):
            if isinstance(item, dict) and item.get("b64_json"):
                image_b64 = item["b64_json"]
                break
        if not image_b64:
            raise RuntimeError("OpenAI Images returned no b64 image")
        pencil_bytes = base64.b64decode(image_b64)
    except httpx.HTTPStatusError as e:
        msg = (e.response.text or str(e))[:400]
        logger.warning("me/avatar: OpenAI HTTP %s: %s", e.response.status_code, msg)
        row.status = "failed"
        row.error = "Could not stylize the photo right now. Please try again."
        db.commit()
        raise HTTPException(status_code=502, detail=row.error)
    except Exception as e:
        logger.exception("me/avatar: stylize failed: %s", e)
        row.status = "failed"
        row.error = "Could not stylize the photo right now. Please try again."
        db.commit()
        raise HTTPException(status_code=502, detail=row.error)

    try:
        pencil_url = _upload_blob(str(current_user.id), pencil_bytes, "_pencil.png", "image/png")
    except Exception as e:
        logger.exception("me/avatar: upload pencil failed: %s", e)
        row.status = "failed"
        row.error = "Could not save the pencil portrait. Please try again."
        db.commit()
        raise HTTPException(status_code=502, detail=row.error)

    row.pencil_blob_url = pencil_url
    row.status = "ready"
    row.error = None
    db.commit()
    db.refresh(row)
    logger.info("me/avatar: user=%s pencil ready", current_user.id)
    return _to_status(row)


@router.delete("", response_model=AvatarStatusOut)
def delete_avatar(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = _ensure_avatar(db, str(current_user.id))
    row.original_photo_blob_url = None
    row.pencil_blob_url = None
    row.status = "none"
    row.error = None
    db.commit()
    db.refresh(row)
    return _to_status(row)
