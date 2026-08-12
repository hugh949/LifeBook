"""TOTP 2FA helpers: secrets, QR, recovery codes."""
from __future__ import annotations

import base64
import hashlib
import io
import secrets
from typing import Sequence

import pyotp
import qrcode

ISSUER = "LifeBook"
RECOVERY_CODE_COUNT = 10
# Unambiguous alphabet (no 0/O, 1/I/L)
_RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def qr_data_url(otpauth_uri: str) -> str:
    """PNG QR as a data URL for the Me → Security enroll UI."""
    img = qrcode.make(otpauth_uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def verify_totp(secret: str, code: str, valid_window: int = 1) -> bool:
    cleaned = (code or "").strip().replace(" ", "")
    if not cleaned.isdigit() or len(cleaned) != 6:
        return False
    try:
        return bool(pyotp.TOTP(secret).verify(cleaned, valid_window=valid_window))
    except Exception:
        return False


def hash_recovery_code(raw: str) -> str:
    normalized = _normalize_recovery(raw)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _normalize_recovery(raw: str) -> str:
    return (raw or "").strip().upper().replace(" ", "").replace("-", "")


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> list[str]:
    codes: list[str] = []
    for _ in range(count):
        left = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
        right = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(4))
        codes.append(f"{left}-{right}")
    return codes


def recovery_codes_match(raw: str, hashed_codes: Sequence[str]) -> str | None:
    """Return the matching hash if ``raw`` matches any unused hashed code."""
    target = hash_recovery_code(raw)
    for h in hashed_codes:
        if secrets.compare_digest(target, h):
            return h
    return None
