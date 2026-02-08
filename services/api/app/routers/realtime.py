import logging
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from app.core.config import settings
from pydantic import BaseModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/realtime", tags=["realtime"])

# Voice companion instructions (V1 spec: warm, validating, one question at a time)
REALTIME_INSTRUCTIONS = """You are a warm, gentle voice companion for an older adult in a family memory app.
- Use a warm, validating tone. Reflect feelings first (e.g. "That sounds important to you").
- Ask one question at a time. Wait for their answer before continuing.
- Do not test memory or correct facts. Never argue about what happened.
- If they seem tired, offer to switch to music or take a break.
- Keep responses concise and easy to follow. Support multiple languages if the user switches."""


class TokenResponse(BaseModel):
    value: str | None = None  # ephemeral client secret (ek_...)
    client_secret: str | None = None  # alias for value
    model: str = "gpt-realtime"
    expires_at: int | None = None
    stubbed: bool = False


@router.post("/token", response_model=TokenResponse)
def mint_token():
    try:
        return _mint_token_impl()
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("realtime/token: unhandled error: %s", e)
        # Always return JSON so clients get parseable detail (avoid plain "Internal Server Error")
        return JSONResponse(
            status_code=500,
            content={"detail": str(e), "type": type(e).__name__},
        )


def _mint_token_impl() -> TokenResponse:
    logger.info("realtime/token: request received")
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        logger.info("realtime/token: no OPENAI_API_KEY, returning stubbed")
        return TokenResponse(
            model=settings.openai_realtime_model or "gpt-realtime",
            stubbed=True,
        )

    model = settings.openai_realtime_model or "gpt-realtime"
    body = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": REALTIME_INSTRUCTIONS,
            "audio": {
                "output": {"voice": "alloy", "speed": 1.0},
            },
        },
    }

    try:
        logger.info("realtime/token: calling OpenAI client_secrets (model=%s)", model)
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=body,
                timeout=15.0,
            )
        r.raise_for_status()
        try:
            data = r.json()
        except Exception as parse_err:
            logger.warning("OpenAI response not JSON: %s", parse_err)
            raise HTTPException(status_code=502, detail="OpenAI returned invalid JSON")
    except httpx.HTTPStatusError as e:
        msg = e.response.text or "OpenAI API error"
        logger.error(
            "realtime/token: OpenAI HTTP %s, body=%s",
            e.response.status_code,
            msg[:500],
            exc_info=True,
        )
        raise HTTPException(
            status_code=e.response.status_code,
            detail=msg if len(msg) < 500 else msg[:500] + "...",
        )
    except Exception as e:
        logger.exception("realtime/token: unexpected error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))

    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Invalid OpenAI response")

    value = data.get("value") or data.get("client_secret")
    if not value or not isinstance(value, str):
        raise HTTPException(status_code=502, detail="No client secret in OpenAI response")

    session = data.get("session")
    resp_model = model
    if isinstance(session, dict):
        resp_model = session.get("model") or model
    raw_expires = data.get("expires_at")
    expires_at = None
    if isinstance(raw_expires, int):
        expires_at = raw_expires
    elif isinstance(raw_expires, (str, float)):
        try:
            expires_at = int(float(raw_expires))
        except (ValueError, TypeError):
            pass

    logger.info("realtime/token: success, model=%s", resp_model)
    return TokenResponse(
        value=value,
        client_secret=value,
        model=resp_model,
        expires_at=expires_at,
        stubbed=False,
    )


class RealtimeCallsBody(BaseModel):
    client_secret: str
    sdp: str


@router.post("/calls")
def realtime_calls(body: RealtimeCallsBody):
    """Proxy SDP offer to OpenAI Realtime; returns SDP answer. Avoids CORS for browser WebRTC."""
    logger.info("realtime/calls: SDP offer received, len=%d", len(body.sdp or ""))
    try:
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/realtime/calls",
                headers={
                    "Authorization": f"Bearer {body.client_secret}",
                    "Content-Type": "application/sdp",
                },
                content=body.sdp.encode("utf-8") if isinstance(body.sdp, str) else body.sdp,
                timeout=15.0,
            )
        r.raise_for_status()
        logger.info("realtime/calls: success, SDP answer len=%d", len(r.text or ""))
        return {"sdp": r.text}
    except httpx.HTTPStatusError as e:
        logger.error(
            "realtime/calls: OpenAI HTTP %s, body=%s",
            e.response.status_code,
            (e.response.text or "")[:500],
            exc_info=True,
        )
        raise HTTPException(
            status_code=e.response.status_code,
            detail=e.response.text or "OpenAI Realtime error",
        )
    except Exception as e:
        logger.exception("realtime/calls: unexpected error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
