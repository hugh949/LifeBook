"""Mint OpenAI Realtime client secrets and proxy SDP for authenticated users.

Scope is a single personal session: no family, no shared-story tools, no
participant model. The agent can help the user turn a conversation into a story
via `confirm_story` but all content stays private to the user.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/realtime", tags=["realtime"])


REALTIME_INSTRUCTIONS = """You are a warm, gentle voice companion in a personal memory app. You help the person feel heard and support them in capturing and shaping their own stories.
- Do not speak until the user has spoken first. Greet briefly when they do and wait.
- When the user ends the session (says goodbye or disconnects), stop speaking immediately.
- Use a warm, validating tone. Reflect feelings first (e.g. "That sounds important to you").
- Ask one question at a time and wait for the answer.
- Do not test memory or correct facts. Never argue about what happened.
- Keep responses concise and easy to follow. Support multiple languages if the user switches.
- When the user asks to "turn this into a story" or says something like "let's make a story out of this", craft a short warm first-person narrative from what they shared and speak it. They can ask for changes; revise and repeat. When they say they're happy (e.g. "that's good", "save it"), you MUST first SPEAK one short sentence so they know to wait—e.g. "I'm going to save your story now; please wait a moment." Only after saying that, call the `confirm_story` tool with the exact final narrative text. After the tool returns, SPEAK again to confirm it's saved and tell them they can find it under Library, and share it from there. Never leave a long silence around saving."""


class TokenRequest(BaseModel):
    conversation_id: str | None = None  # recall a past conversation
    story_id: str | None = None  # refine an existing story


class TokenResponse(BaseModel):
    value: str | None = None
    client_secret: str | None = None
    model: str = "gpt-realtime"
    expires_at: int | None = None
    stubbed: bool = False


def _load_conversation(db: Session, owner_id: str, conversation_id: str) -> models.Conversation | None:
    return (
        db.query(models.Conversation)
        .filter(
            models.Conversation.id == conversation_id,
            models.Conversation.owner_user_id == owner_id,
            models.Conversation.deleted_at.is_(None),
        )
        .first()
    )


def _load_story(db: Session, owner_id: str, story_id: str) -> models.Story | None:
    return (
        db.query(models.Story)
        .filter(
            models.Story.id == story_id,
            models.Story.owner_user_id == owner_id,
            models.Story.deleted_at.is_(None),
        )
        .first()
    )


@router.post("/token", response_model=TokenResponse)
def mint_token(
    body: TokenRequest | None = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return _mint_token_impl(body or TokenRequest(), current_user, db)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("realtime/token: unhandled error: %s", e)
        return JSONResponse(
            status_code=500,
            content={"detail": str(e), "type": type(e).__name__},
        )


def _mint_token_impl(
    body: TokenRequest,
    current_user: models.User,
    db: Session,
) -> TokenResponse:
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        return TokenResponse(
            model=settings.openai_realtime_model or "gpt-realtime",
            stubbed=True,
        )

    model = settings.openai_realtime_model or "gpt-realtime"
    name = (current_user.display_name or "").strip() or "there"
    instructions = (
        REALTIME_INSTRUCTIONS
        + f"\n\nThe person speaking is {name}. Greet them by name when they begin."
    )

    if body.conversation_id:
        conv = _load_conversation(db, str(current_user.id), body.conversation_id)
        if conv and isinstance(conv.session_turns_json, list):
            lines = []
            for t in conv.session_turns_json:
                if isinstance(t, dict) and t.get("role") in ("user", "assistant") and t.get("content"):
                    who = "User" if t["role"] == "user" else "Assistant"
                    lines.append(f"{who}: {t['content']}")
            if lines:
                instructions += (
                    "\n\nRecalled conversation (the user may want to continue this or turn it into a story):\n"
                    + "\n".join(lines[-40:])
                )
                instructions += (
                    "\n\nRECALLED: briefly acknowledge you're picking up this thread and invite them to go deeper "
                    "or to turn it into a story."
                )
    elif body.story_id:
        story = _load_story(db, str(current_user.id), body.story_id)
        if story:
            story_text = (story.story_text or story.summary or "").strip()
            if story_text:
                instructions += (
                    "\n\nStory chosen for refinement (the person wants to review or adjust this):\n"
                    + story_text[:4000]
                    + "\n\nAsk if they want to review or change sections, keep it short and warm. "
                    "When they are happy: speak a short sentence that you are saving, then call `confirm_story` "
                    "with the final text; after the tool returns, SPEAK to confirm it is saved."
                )

    tools = [
        {
            "type": "function",
            "name": "confirm_story",
            "description": (
                "Call when the user has approved the narrated story and said they are happy with it. "
                "You MUST first speak a short sentence like 'I'm going to save your story now; please wait a moment.' "
                "Only after saying that, call this tool with the exact final story text. After the tool returns, "
                "SPEAK to confirm the story is saved and they can find it under Library."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "story_text": {
                        "type": "string",
                        "description": "The final narrative text of the story as agreed with the user.",
                    },
                },
                "required": ["story_text"],
            },
        },
        {
            "type": "function",
            "name": "forget_current_conversation",
            "description": (
                "Call when the user asks to forget this conversation or not save it. "
                "After calling, confirm that this conversation will not be saved."
            ),
            "parameters": {"type": "object", "properties": {}},
        },
    ]

    payload = {
        "expires_after": {"anchor": "created_at", "seconds": 600},
        "session": {
            "type": "realtime",
            "model": model,
            "instructions": instructions,
            "audio": {
                "input": {"transcription": {"model": "whisper-1"}},
                "output": {"voice": "alloy", "speed": 1.0},
            },
            "tools": tools,
            "tool_choice": "auto",
        },
    }

    try:
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/realtime/client_secrets",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15.0,
            )
        r.raise_for_status()
        data = r.json()
    except httpx.HTTPStatusError as e:
        msg = e.response.text or "OpenAI API error"
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

    session = data.get("session") or {}
    resp_model = (session.get("model") if isinstance(session, dict) else None) or model
    raw_expires = data.get("expires_at")
    expires_at = None
    if isinstance(raw_expires, int):
        expires_at = raw_expires
    elif isinstance(raw_expires, (str, float)):
        try:
            expires_at = int(float(raw_expires))
        except (ValueError, TypeError):
            pass
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
def realtime_calls(
    body: RealtimeCallsBody,
    current_user: models.User = Depends(get_current_user),
):
    """Proxy SDP offer to OpenAI Realtime; returns SDP answer. Avoids CORS for WebRTC."""
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
        return {"sdp": r.text}
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=e.response.status_code,
            detail=e.response.text or "OpenAI Realtime error",
        )
    except Exception as e:
        logger.exception("realtime/calls: unexpected error: %s", e)
        raise HTTPException(status_code=502, detail=str(e))
