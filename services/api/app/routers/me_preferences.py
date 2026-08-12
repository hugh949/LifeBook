"""Chief-of-Staff preferences API (learned memory + light manual overrides)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.user_preferences import (
    dismiss_learned_item,
    get_or_create_prefs,
    prefs_have_content,
    reset_prefs,
)


router = APIRouter(prefix="/me/preferences", tags=["preferences"])


class PreferencesOut(BaseModel):
    prefs: dict[str, Any]
    has_memory: bool = False


class PreferencesPatch(BaseModel):
    tone: str | None = None
    story_length: str | None = None
    topics_to_avoid: str | None = None
    dont_offer_sharing: bool | None = None
    preferred_bgm: str | None = None
    language: str | None = None
    notes: str | None = None
    remember: str | None = Field(
        default=None,
        description="Optional manual note the user asked LifeBook to remember.",
    )
    correction: str | None = Field(
        default=None,
        description="Structured correction after rejecting or editing a draft.",
    )
    dismiss_item_id: str | None = Field(
        default=None,
        description="Remove a learned item by id and prevent re-learning it.",
    )
    dismiss_item_text: str | None = Field(
        default=None,
        description="Remove a learned item by text and prevent re-learning it.",
    )
    clear_memory: bool | None = Field(
        default=None,
        description="When true, wipe all learned and manual preference memory.",
    )


@router.get("", response_model=PreferencesOut)
def get_preferences(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = get_or_create_prefs(db, str(current_user.id))
    prefs = row.prefs_json if isinstance(row.prefs_json, dict) else {}
    return PreferencesOut(prefs=prefs, has_memory=prefs_have_content(prefs))


@router.patch("", response_model=PreferencesOut)
def patch_preferences(
    body: PreferencesPatch,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = get_or_create_prefs(db, str(current_user.id))
    prefs: dict[str, Any] = dict(row.prefs_json) if isinstance(row.prefs_json, dict) else {}

    if body.clear_memory:
        prefs = reset_prefs()
        row.prefs_json = prefs
        row.updated_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(row)
        return PreferencesOut(prefs={}, has_memory=False)

    if body.dismiss_item_id or body.dismiss_item_text:
        prefs = dismiss_learned_item(
            prefs,
            item_id=(body.dismiss_item_id or "").strip() or None,
            text=(body.dismiss_item_text or "").strip() or None,
        )

    if body.tone is not None:
        prefs["tone"] = body.tone.strip()
    if body.story_length is not None:
        prefs["story_length"] = body.story_length.strip()
    if body.topics_to_avoid is not None:
        prefs["topics_to_avoid"] = body.topics_to_avoid.strip()
    if body.dont_offer_sharing is not None:
        prefs["dont_offer_sharing"] = bool(body.dont_offer_sharing)
    if body.preferred_bgm is not None:
        prefs["preferred_bgm"] = body.preferred_bgm.strip()
    if body.language is not None:
        prefs["language"] = body.language.strip()
    if body.notes is not None:
        prefs["notes"] = body.notes.strip()

    corrections = prefs.get("corrections")
    if not isinstance(corrections, list):
        corrections = []
    if body.correction and body.correction.strip():
        corrections.append(
            {
                "text": body.correction.strip()[:500],
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )
    if body.remember and body.remember.strip():
        corrections.append(
            {
                "text": body.remember.strip()[:500],
                "at": datetime.now(timezone.utc).isoformat(),
                "kind": "remember",
            }
        )
        # Also surface as a learned item so Me UI lists it with dismiss controls
        items = prefs.get("learned_items")
        if not isinstance(items, list):
            items = []
        items.append(
            {
                "id": uuid.uuid4().hex[:12],
                "text": body.remember.strip()[:280],
                "source": "manual",
                "at": datetime.now(timezone.utc).isoformat(),
            }
        )
        prefs["learned_items"] = items[-24:]
        if not (isinstance(prefs.get("learned_summary"), str) and prefs["learned_summary"].strip()):
            prefs["learned_summary"] = (
                "You asked LifeBook to remember specific notes. "
                "Those notes appear below and guide future conversations."
            )
    prefs["corrections"] = corrections[-40:]

    row.prefs_json = prefs
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(row)
    out = prefs if isinstance(row.prefs_json, dict) else {}
    return PreferencesOut(prefs=out, has_memory=prefs_have_content(out))


@router.delete("", response_model=PreferencesOut)
def delete_preferences(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Clear all preference memory for the current user."""
    row = get_or_create_prefs(db, str(current_user.id))
    row.prefs_json = reset_prefs()
    row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return PreferencesOut(prefs={}, has_memory=False)
