"""Session security: bcrypt password hashing + HS256 JWT cookie tokens.

Password reset uses hashed one-time tokens (see ``/auth/forgot-password``).
Short-lived 2FA challenge JWTs use ``purpose=2fa_challenge`` and are never
accepted as session cookies.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from datetime import datetime, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db import models
from app.db.session import get_db


logger = logging.getLogger(__name__)

# Short-lived token after password OK when TOTP is enabled (seconds).
TWO_FA_CHALLENGE_TTL_SECONDS = 300


# -- Password hashing --------------------------------------------------------

def hash_password(password: str) -> str:
    """Hash a plaintext password with bcrypt (cost 12)."""
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


# -- JWT (HS256) --------------------------------------------------------------

def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def _sign(msg: bytes, secret: str) -> str:
    sig = hmac.new(secret.encode("utf-8"), msg, hashlib.sha256).digest()
    return _b64url_encode(sig)


def _encode_jwt(payload: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    p = _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    signing = f"{h}.{p}".encode("ascii")
    sig = _sign(signing, settings.session_secret)
    return f"{h}.{p}.{sig}"


def _decode_jwt(token: str) -> Optional[dict]:
    try:
        h_b64, p_b64, sig = token.split(".")
    except ValueError:
        return None
    signing = f"{h_b64}.{p_b64}".encode("ascii")
    expected = _sign(signing, settings.session_secret)
    if not hmac.compare_digest(expected, sig):
        return None
    try:
        payload = json.loads(_b64url_decode(p_b64).decode("utf-8"))
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if int(payload.get("exp") or 0) < int(time.time()):
        return None
    return payload


def make_session_token(user_id: str, ttl_days: Optional[int] = None) -> str:
    """Issue an HS256 JWT with `sub=user_id`, `iat`, `exp`."""
    now = int(time.time())
    ttl = (ttl_days if ttl_days is not None else settings.session_ttl_days) * 86400
    return _encode_jwt({"sub": user_id, "iat": now, "exp": now + ttl})


def decode_session_token(token: str) -> Optional[dict]:
    payload = _decode_jwt(token)
    if not payload:
        return None
    # Challenge tokens must never be treated as sessions.
    if payload.get("purpose"):
        return None
    return payload


def make_2fa_challenge_token(user_id: str, ttl_seconds: int = TWO_FA_CHALLENGE_TTL_SECONDS) -> str:
    """Short-lived token proving password succeeded; not a session."""
    now = int(time.time())
    return _encode_jwt(
        {
            "sub": user_id,
            "iat": now,
            "exp": now + ttl_seconds,
            "purpose": "2fa_challenge",
        }
    )


def decode_2fa_challenge_token(token: str) -> Optional[str]:
    """Return user_id if token is a valid 2FA challenge, else None."""
    payload = _decode_jwt(token)
    if not payload:
        return None
    if payload.get("purpose") != "2fa_challenge":
        return None
    user_id = payload.get("sub")
    return str(user_id) if user_id else None


# -- Cookie helpers ----------------------------------------------------------

def set_session_cookie(response: Response, token: str) -> None:
    """Attach the session cookie. HttpOnly + SameSite=Lax for pilot."""
    max_age = settings.session_ttl_days * 86400
    secure = settings.app_env != "local"
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=settings.session_cookie_name, path="/")


# -- Dependencies -------------------------------------------------------------

def get_current_user(
    request: Request,
    db: Session = Depends(get_db),
) -> models.User:
    """FastAPI dependency that loads the current user or raises 401."""
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise HTTPException(status_code=401, detail="Not signed in")
    payload = decode_session_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Session expired")
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Account not found")
    return user


def get_optional_user(
    request: Request,
    db: Session = Depends(get_db),
) -> Optional[models.User]:
    """Return the user if signed in, else None. Used on public routes that may
    also show owner-only affordances (e.g. share preview)."""
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        return None
    payload = decode_session_token(token)
    if not payload:
        return None
    user_id = payload.get("sub")
    if not user_id:
        return None
    return db.query(models.User).filter(models.User.id == user_id).first()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def random_share_token(nbytes: int = 16) -> str:
    """URL-safe share token (22 chars when nbytes=16)."""
    return _b64url_encode(secrets.token_bytes(nbytes))
