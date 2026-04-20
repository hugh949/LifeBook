"""Email+password auth endpoints: signup, signin, signout, me."""
from __future__ import annotations

import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.security import (
    clear_session_cookie,
    get_current_user,
    hash_password,
    make_session_token,
    set_session_cookie,
    verify_password,
)
from app.db import models
from app.db.session import get_db


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])


_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class SignupBody(BaseModel):
    email: str = Field(..., min_length=3, max_length=255)
    password: str = Field(..., min_length=8, max_length=256)
    display_name: str = Field(..., min_length=1, max_length=120)


class SigninBody(BaseModel):
    email: str
    password: str


class MeResponse(BaseModel):
    id: str
    email: str
    display_name: str


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _user_to_me(user: models.User) -> MeResponse:
    return MeResponse(id=str(user.id), email=user.email, display_name=user.display_name)


@router.post("/signup", response_model=MeResponse)
def signup(body: SignupBody, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")
    display_name = (body.display_name or "").strip()
    if not display_name:
        raise HTTPException(status_code=400, detail="Please enter a display name.")
    existing = db.query(models.User).filter(models.User.email == email).first()
    if existing:
        raise HTTPException(status_code=409, detail="An account already exists with that email.")
    user = models.User(
        email=email,
        password_hash=hash_password(body.password),
        display_name=display_name[:120],
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(models.UserVoice(user_id=user.id))
    db.add(models.UserAvatar(user_id=user.id))
    db.commit()
    token = make_session_token(str(user.id))
    set_session_cookie(response, token)
    logger.info("auth/signup: user_id=%s email=%s", user.id, email)
    return _user_to_me(user)


@router.post("/signin", response_model=MeResponse)
def signin(body: SigninBody, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(body.password, user.password_hash):
        # Keep the error generic to not enumerate accounts.
        raise HTTPException(status_code=401, detail="Wrong email or password.")
    token = make_session_token(str(user.id))
    set_session_cookie(response, token)
    logger.info("auth/signin: user_id=%s", user.id)
    return _user_to_me(user)


@router.post("/signout")
def signout(response: Response):
    clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(current_user: models.User = Depends(get_current_user)):
    return _user_to_me(current_user)


class UpdateMeBody(BaseModel):
    display_name: str | None = None


@router.patch("/me", response_model=MeResponse)
def update_me(
    body: UpdateMeBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if body.display_name is not None:
        name = body.display_name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Display name cannot be empty.")
        current_user.display_name = name[:120]
        db.commit()
        db.refresh(current_user)
    return _user_to_me(current_user)
