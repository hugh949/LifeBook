from datetime import datetime, timezone, timedelta
from uuid import uuid4
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.db.session import get_db
from app.db import models
from app.core.config import settings, DEFAULT_FAMILY_ID
from app.core.azure_storage import generate_upload_sas
from app.schemas.media import SasRequest, SasResponse, CompleteRequest, CompleteResponse

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/sas", response_model=SasResponse)
def create_sas(body: SasRequest):
    blob_path = f"{body.type}s/{uuid4()}_{body.fileName}"
    if settings.azure_storage_account and settings.azure_storage_account_key:
        container = settings.photos_container if body.type == "photo" else settings.audio_container
        blob_url, upload_url = generate_upload_sas(
            account_name=settings.azure_storage_account,
            account_key=settings.azure_storage_account_key,
            container=container,
            blob_name=blob_path,
            expiry_minutes=settings.sas_ttl_minutes,
        )
    else:
        blob_url = f"https://local-mvp/lifebook/{blob_path}"
        upload_url = blob_url
    expires = (datetime.now(timezone.utc) + timedelta(minutes=settings.sas_ttl_minutes)).isoformat().replace("+00:00", "Z")
    return SasResponse(uploadUrl=upload_url, blobUrl=blob_url, expiresAt=expires)


@router.post("/complete", response_model=CompleteResponse)
def complete_upload(body: CompleteRequest, db: Session = Depends(get_db)):
    asset = models.Asset(
        family_id=DEFAULT_FAMILY_ID,
        type=body.type,
        blob_url=body.blobUrl,
        metadata_json=body.metadata,
    )
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return CompleteResponse(assetId=asset.id)
