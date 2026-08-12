"""Outbound email helpers (password reset). Uses SMTP when configured."""
from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage

from app.core.config import settings

logger = logging.getLogger(__name__)


def smtp_configured() -> bool:
    return bool((settings.smtp_host or "").strip() and (settings.smtp_from or "").strip())


def send_email(*, to: str, subject: str, text_body: str) -> bool:
    """Send a plain-text email via SMTP. Returns True on success."""
    if not smtp_configured():
        logger.warning("email: SMTP not configured; skipping send to=%s subject=%s", to, subject)
        return False
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = settings.smtp_from.strip()
    msg["To"] = to
    msg.set_content(text_body)
    try:
        with smtplib.SMTP(settings.smtp_host.strip(), settings.smtp_port, timeout=20) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            user = (settings.smtp_user or "").strip()
            password = settings.smtp_password or ""
            if user:
                smtp.login(user, password)
            smtp.send_message(msg)
        logger.info("email: sent to=%s subject=%s", to, subject)
        return True
    except Exception as e:
        logger.exception("email: send failed to=%s err=%s", to, e)
        return False
