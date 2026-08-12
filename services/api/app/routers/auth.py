"""Email+password auth endpoints: signup, signin, signout, me, password reset."""
from __future__ import annotations

import hashlib
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import settings
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
from app.services.email_send import send_email, smtp_configured


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])

_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
RESET_TOKEN_TTL_MINUTES = 60


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


class ForgotPasswordBody(BaseModel):
    email: str


class ForgotPasswordOut(BaseModel):
    ok: bool = True
    message: str
    # Only present in local/dev when SMTP is not configured (so you can click the link).
    dev_reset_url: str | None = None


class ResetPasswordBody(BaseModel):
    token: str = Field(..., min_length=16, max_length=256)
    password: str = Field(..., min_length=8, max_length=256)


class UpdateMeBody(BaseModel):
    display_name: str | None = None


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _user_to_me(user: models.User) -> MeResponse:
    return MeResponse(id=str(user.id), email=user.email, display_name=user.display_name)


def _hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _public_origin() -> str:
    return (settings.public_app_url or "http://localhost:3000").rstrip("/")


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


@router.post("/forgot-password", response_model=ForgotPasswordOut)
def forgot_password(body: ForgotPasswordBody, db: Session = Depends(get_db)):
    """Start a password reset. Always returns a generic success message (no email enumeration)."""
    email = _normalize_email(body.email)
    generic = (
        "If an account exists for that email, we sent a reset link. "
        "It expires in about an hour."
    )
    if not _EMAIL_RE.match(email):
        return ForgotPasswordOut(message=generic)

    user = db.query(models.User).filter(models.User.email == email).first()
    if not user:
        return ForgotPasswordOut(message=generic)

    raw = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    row = models.PasswordResetToken(
        user_id=str(user.id),
        token_hash=_hash_reset_token(raw),
        expires_at=now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES),
        created_at=now,
    )
    db.add(row)
    db.commit()

    reset_url = f"{_public_origin()}/reset-password?token={raw}"
    body_text = (
        f"Hi {user.display_name},\n\n"
        "Someone asked to reset your LifeBook password. "
        f"Open this link within {RESET_TOKEN_TTL_MINUTES} minutes:\n\n"
        f"{reset_url}\n\n"
        "If you did not ask for this, you can ignore this email.\n"
    )
    sent = send_email(
        to=user.email,
        subject="Reset your LifeBook password",
        text_body=body_text,
    )
    logger.info(
        "auth/forgot-password: user_id=%s smtp_sent=%s smtp_configured=%s",
        user.id,
        sent,
        smtp_configured(),
    )

    # Local/dev without SMTP: return the link so the operator can reset.
    dev_url = None
    if settings.app_env == "local" and not sent:
        dev_url = reset_url
        logger.info("auth/forgot-password: local reset link for %s → %s", email, reset_url)

    return ForgotPasswordOut(message=generic, dev_reset_url=dev_url)


@router.post("/reset-password")
def reset_password(body: ResetPasswordBody, response: Response, db: Session = Depends(get_db)):
    """Consume a one-time reset token and set a new password; signs the user in."""
    raw = (body.token or "").strip()
    if len(raw) < 16:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")
    token_hash = _hash_reset_token(raw)
    now = datetime.now(timezone.utc)
    row = (
        db.query(models.PasswordResetToken)
        .filter(
            models.PasswordResetToken.token_hash == token_hash,
            models.PasswordResetToken.used_at.is_(None),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")
    expires = row.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires < now:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")

    user = db.query(models.User).filter(models.User.id == row.user_id).first()
    if not user:
        raise HTTPException(status_code=400, detail="This reset link is invalid or expired.")

    user.password_hash = hash_password(body.password)
    row.used_at = now
    others = (
        db.query(models.PasswordResetToken)
        .filter(
            models.PasswordResetToken.user_id == user.id,
            models.PasswordResetToken.used_at.is_(None),
            models.PasswordResetToken.id != row.id,
        )
        .all()
    )
    for o in others:
        o.used_at = now
    db.commit()

    session = make_session_token(str(user.id))
    set_session_cookie(response, session)
    logger.info("auth/reset-password: user_id=%s", user.id)
    return {"ok": True, "me": _user_to_me(user)}
