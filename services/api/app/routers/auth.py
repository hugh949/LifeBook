"""Email+password auth endpoints: signup, signin, signout, me, password reset, optional TOTP 2FA."""
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
    decode_2fa_challenge_token,
    get_current_user,
    hash_password,
    make_2fa_challenge_token,
    make_session_token,
    set_session_cookie,
    verify_password,
)
from app.core.totp import (
    generate_recovery_codes,
    generate_totp_secret,
    hash_recovery_code,
    provisioning_uri,
    qr_data_url,
    verify_totp,
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
    totp_enabled: bool = False


class SigninResponse(BaseModel):
    """Either a full session (me fields) or a 2FA challenge (no cookie yet)."""

    requires_2fa: bool = False
    challenge_token: str | None = None
    id: str | None = None
    email: str | None = None
    display_name: str | None = None
    totp_enabled: bool = False


class Signin2faBody(BaseModel):
    challenge_token: str = Field(..., min_length=16, max_length=2048)
    code: str = Field(..., min_length=4, max_length=64)


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


class TwoFaStatusOut(BaseModel):
    enabled: bool
    recovery_codes_remaining: int = 0


class TwoFaSetupOut(BaseModel):
    secret: str
    otpauth_uri: str
    qr_data_url: str


class TwoFaEnableBody(BaseModel):
    code: str = Field(..., min_length=6, max_length=12)


class TwoFaEnableOut(BaseModel):
    enabled: bool = True
    recovery_codes: list[str]


class TwoFaDisableBody(BaseModel):
    password: str | None = None
    code: str | None = None


class TwoFaRegenBody(BaseModel):
    password: str | None = None
    code: str | None = None


class TwoFaRegenOut(BaseModel):
    recovery_codes: list[str]


def _normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _user_to_me(user: models.User) -> MeResponse:
    return MeResponse(
        id=str(user.id),
        email=user.email,
        display_name=user.display_name,
        totp_enabled=bool(user.totp_enabled),
    )


def _signin_ok(user: models.User) -> SigninResponse:
    me = _user_to_me(user)
    return SigninResponse(
        requires_2fa=False,
        id=me.id,
        email=me.email,
        display_name=me.display_name,
        totp_enabled=me.totp_enabled,
    )


def _hash_reset_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _public_origin() -> str:
    return (settings.public_app_url or "http://localhost:3000").rstrip("/")


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _recovery_remaining(db: Session, user_id: str) -> int:
    return (
        db.query(models.UserRecoveryCode)
        .filter(
            models.UserRecoveryCode.user_id == user_id,
            models.UserRecoveryCode.used_at.is_(None),
        )
        .count()
    )


def _replace_recovery_codes(db: Session, user: models.User) -> list[str]:
    """Delete existing codes and insert a fresh set; return plaintext once."""
    db.query(models.UserRecoveryCode).filter(models.UserRecoveryCode.user_id == user.id).delete()
    plain = generate_recovery_codes()
    for raw in plain:
        db.add(
            models.UserRecoveryCode(
                user_id=user.id,
                code_hash=hash_recovery_code(raw),
            )
        )
    return plain


def _consume_recovery_code(db: Session, user: models.User, raw: str) -> bool:
    target = hash_recovery_code(raw)
    rows = (
        db.query(models.UserRecoveryCode)
        .filter(
            models.UserRecoveryCode.user_id == user.id,
            models.UserRecoveryCode.used_at.is_(None),
        )
        .all()
    )
    for row in rows:
        if secrets.compare_digest(target, row.code_hash):
            row.used_at = _utcnow()
            return True
    return False


def _verify_totp_or_recovery(db: Session, user: models.User, code: str) -> bool:
    """Accept a 6-digit TOTP or an unused recovery code. Recovery codes are consumed."""
    secret = user.totp_secret or ""
    cleaned = (code or "").strip()
    if secret and verify_totp(secret, cleaned):
        return True
    if _consume_recovery_code(db, user, cleaned):
        return True
    return False


def _require_password_or_2fa(
    db: Session,
    user: models.User,
    password: str | None,
    code: str | None,
) -> None:
    """For disable / regenerate: password OR (when 2FA on) TOTP/recovery."""
    if password and verify_password(password, user.password_hash):
        return
    if user.totp_enabled and code and _verify_totp_or_recovery(db, user, code):
        return
    raise HTTPException(
        status_code=401,
        detail="Enter your password or a valid authenticator / recovery code.",
    )


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


@router.post("/signin", response_model=SigninResponse)
def signin(body: SigninBody, response: Response, db: Session = Depends(get_db)):
    email = _normalize_email(body.email)
    user = db.query(models.User).filter(models.User.email == email).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Wrong email or password.")

    if user.totp_enabled and user.totp_secret:
        challenge = make_2fa_challenge_token(str(user.id))
        logger.info("auth/signin: user_id=%s requires_2fa=1", user.id)
        return SigninResponse(requires_2fa=True, challenge_token=challenge)

    token = make_session_token(str(user.id))
    set_session_cookie(response, token)
    logger.info("auth/signin: user_id=%s", user.id)
    return _signin_ok(user)


@router.post("/signin/2fa", response_model=MeResponse)
def signin_2fa(body: Signin2faBody, response: Response, db: Session = Depends(get_db)):
    user_id = decode_2fa_challenge_token(body.challenge_token)
    if not user_id:
        raise HTTPException(status_code=401, detail="This sign-in step expired. Enter your password again.")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.totp_enabled or not user.totp_secret:
        raise HTTPException(status_code=401, detail="Two-factor authentication is not available for this account.")
    if not _verify_totp_or_recovery(db, user, body.code):
        raise HTTPException(status_code=401, detail="Invalid authenticator or recovery code.")
    db.commit()
    token = make_session_token(str(user.id))
    set_session_cookie(response, token)
    logger.info("auth/signin/2fa: user_id=%s", user.id)
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


@router.get("/2fa/status", response_model=TwoFaStatusOut)
def twofa_status(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return TwoFaStatusOut(
        enabled=bool(current_user.totp_enabled),
        recovery_codes_remaining=_recovery_remaining(db, current_user.id) if current_user.totp_enabled else 0,
    )


@router.post("/2fa/setup", response_model=TwoFaSetupOut)
def twofa_setup(
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is already on.")
    secret = generate_totp_secret()
    current_user.totp_secret = secret
    current_user.totp_enabled = False
    current_user.totp_enabled_at = None
    db.commit()
    uri = provisioning_uri(secret, current_user.email)
    return TwoFaSetupOut(secret=secret, otpauth_uri=uri, qr_data_url=qr_data_url(uri))


@router.post("/2fa/enable", response_model=TwoFaEnableOut)
def twofa_enable(
    body: TwoFaEnableBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="Two-factor authentication is already on.")
    secret = current_user.totp_secret
    if not secret:
        raise HTTPException(status_code=400, detail="Start setup first, then enter a code from your authenticator.")
    if not verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="That code did not match. Try again.")
    current_user.totp_enabled = True
    current_user.totp_enabled_at = _utcnow()
    codes = _replace_recovery_codes(db, current_user)
    db.commit()
    logger.info("auth/2fa/enable: user_id=%s", current_user.id)
    return TwoFaEnableOut(recovery_codes=codes)


@router.post("/2fa/disable")
def twofa_disable(
    body: TwoFaDisableBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.totp_enabled:
        return {"ok": True, "enabled": False}
    _require_password_or_2fa(db, current_user, body.password, body.code)
    current_user.totp_enabled = False
    current_user.totp_secret = None
    current_user.totp_enabled_at = None
    db.query(models.UserRecoveryCode).filter(models.UserRecoveryCode.user_id == current_user.id).delete()
    db.commit()
    logger.info("auth/2fa/disable: user_id=%s", current_user.id)
    return {"ok": True, "enabled": False}


@router.post("/2fa/recovery-codes/regenerate", response_model=TwoFaRegenOut)
def twofa_regen_recovery(
    body: TwoFaRegenBody,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not current_user.totp_enabled:
        raise HTTPException(status_code=400, detail="Turn on two-factor authentication first.")
    _require_password_or_2fa(db, current_user, body.password, body.code)
    codes = _replace_recovery_codes(db, current_user)
    db.commit()
    logger.info("auth/2fa/recovery-codes/regenerate: user_id=%s", current_user.id)
    return TwoFaRegenOut(recovery_codes=codes)


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
