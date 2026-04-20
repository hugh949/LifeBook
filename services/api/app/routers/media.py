"""Media upload SAS + asset-create for the signed-in user."""
import logging
from datetime import datetime, timezone, timedelta
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.azure_storage import generate_upload_sas
from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.schemas.media import (
    CompleteRequest,
    CompleteResponse,
    SasRequest,
    SasResponse,
)


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/media", tags=["media"])


@router.post("/sas", response_model=SasResponse)
def create_sas(
    body: SasRequest,
    current_user: models.User = Depends(get_current_user),
):
    try:
        return _create_sas_impl(body, str(current_user.id))
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("media/sas: unhandled error: %s", e)
        raise HTTPException(status_code=500, detail=f"media/sas: {str(e)}")


def _create_sas_impl(body: SasRequest, owner_user_id: str) -> SasResponse:
    blob_path = f"u/{owner_user_id}/{body.type}s/{uuid4()}_{body.fileName}"
    if settings.azure_storage_account and settings.azure_storage_account_key:
        container = settings.photos_container if body.type == "photo" else settings.audio_container
        blob_url, upload_url = generate_upload_sas(
            account_name=settings.azure_storage_account,
            account_key=settings.azure_storage_account_key,
            container=container,
            blob_name=blob_path,
            expiry_minutes=settings.sas_ttl_minutes,
        )
        expires = (
            datetime.now(timezone.utc) + timedelta(minutes=settings.sas_ttl_minutes)
        ).isoformat().replace("+00:00", "Z")
        return SasResponse(uploadUrl=upload_url, blobUrl=blob_url, expiresAt=expires)
    # Local stub: no Azure configured
    blob_url = f"https://local-mvp/lifebook/{blob_path}"
    expires = (
        datetime.now(timezone.utc) + timedelta(minutes=settings.sas_ttl_minutes)
    ).isoformat().replace("+00:00", "Z")
    return SasResponse(uploadUrl=blob_url, blobUrl=blob_url, expiresAt=expires)


@router.post("/complete", response_model=CompleteResponse)
def complete_upload(
    body: CompleteRequest,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    asset = models.Asset(
        owner_user_id=current_user.id,
        type=body.type,
        blob_url=body.blobUrl,
        metadata_json=body.metadata,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    logger.info("media/complete: owner=%s type=%s assetId=%s", current_user.id, body.type, asset.id)
    return CompleteResponse(assetId=asset.id)
