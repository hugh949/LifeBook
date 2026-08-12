"""Mint OpenAI Realtime client secrets and proxy SDP for authenticated users.

Chief-of-Staff selects an agent instruction pack (Conversation / Storyteller / Curator).
Sharing tools are never exposed here — access control is Agent 4 (REST only).
"""
import logging
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.openai_models import realtime_model
from app.core.security import get_current_user
from app.db import models
from app.db.session import get_db
from app.services.narration import voice_enrollment_snapshot
from app.services.agent_packs import (
    AgentMode,
    instructions_for_mode,
    normalize_mode,
    tools_for_mode,
)
from app.services.user_preferences import preference_notes_for_prompt


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/realtime", tags=["realtime"])


class TokenRequest(BaseModel):
    conversation_id: str | None = None
    story_id: str | None = None
    mode: Literal["conversing", "storytelling", "curating"] | None = None


class TokenResponse(BaseModel):
    value: str | None = None
    client_secret: str | None = None
    model: str = "gpt-realtime-2.1"
    expires_at: int | None = None
    stubbed: bool = False
    mode: AgentMode = "conversing"


class AgentPackOut(BaseModel):
    mode: AgentMode
    instructions: str
    tools: list[dict]


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


def _turn_lines(turns: list | None, *, limit: int = 40) -> list[str]:
    if not isinstance(turns, list):
        return []
    lines: list[str] = []
    for t in turns:
        if isinstance(t, dict) and t.get("role") in ("user", "assistant") and t.get("content"):
            who = "User" if t["role"] == "user" else "Assistant"
            lines.append(f"{who}: {t['content']}")
    return lines[-limit:]


def _build_instructions(
    body: TokenRequest,
    current_user: models.User,
    db: Session,
    mode: AgentMode,
) -> str:
    name = (current_user.display_name or "").strip() or "there"
    notes = preference_notes_for_prompt(db, str(current_user.id))
    instructions = instructions_for_mode(mode, display_name=name, preference_notes=notes)

    owner_id = str(current_user.id)
    conv = (
        _load_conversation(db, owner_id, body.conversation_id) if body.conversation_id else None
    )
    story = _load_story(db, owner_id, body.story_id) if body.story_id else None

    # When only story_id is set, still load source conversation for transcript context
    if story and not conv and story.source_conversation_id:
        conv = _load_conversation(db, owner_id, str(story.source_conversation_id))

    # When conversation is set without story_id, surface linked script if present
    if conv and not story:
        linked = (
            db.query(models.Story)
            .filter(
                models.Story.source_conversation_id == conv.id,
                models.Story.owner_user_id == owner_id,
                models.Story.deleted_at.is_(None),
            )
            .order_by(models.Story.created_at.desc())
            .first()
        )
        if linked:
            story = linked

    turn_lines = _turn_lines(conv.session_turns_json if conv else None)
    script_text = ((story.story_text if story else None) or (story.summary if story else None) or "").strip()

    if mode == "conversing":
        instructions += (
            "\n\nSTUDIO CONTEXT — Conversation:\n"
            "- Before: entry into Conversation Studio (or Create → new memory).\n"
            "- This: elicitation only; exact transcript is the artifact.\n"
            "- Next: Script (derive / Storyteller). Curate and Share come later — never pressure share."
        )
        if turn_lines:
            instructions += (
                "\n\nRecent turns (continue this thread):\n" + "\n".join(turn_lines)
            )
            instructions += (
                "\n\nRECALLED: briefly acknowledge you're picking up this thread and invite them "
                "to go deeper. Offer Script only when they seem ready."
            )
        if script_text:
            instructions += (
                "\n\nNote: a Script already exists for this talk. They can refresh it later; "
                "keep focusing on dialogue unless they ask to advance."
            )

    elif mode == "storytelling":
        instructions += (
            "\n\nSTUDIO CONTEXT — Script:\n"
            "- Before: Conversation transcript (exact words).\n"
            "- This: craft/refine the professional script while they can still see it on screen.\n"
            "- Next: Curate (music, tone, voice, one photo). Share is optional access after Curate."
        )
        if turn_lines:
            instructions += (
                "\n\nTranscript excerpt (keep meaning; do not invent major facts):\n"
                + "\n".join(turn_lines[-24:])
            )
        if script_text:
            instructions += (
                "\n\nCurrent script text on the canvas (revise from this):\n" + script_text[:4000]
            )
        else:
            instructions += (
                "\n\nNo script text saved yet — craft a clear first-person draft from the transcript."
            )

    else:  # curating
        bgm = ((story.bgm_track if story else None) or "neutral").strip() or "neutral"
        tone = ((story.narration_tone if story else None) or "warm").strip() or "warm"
        has_photo = bool(story and story.photo_asset_id)
        has_unique = bool(story and getattr(story, "bgm_asset_id", None))
        voice = voice_enrollment_snapshot(db, str(current_user.id))
        instructions += (
            "\n\nSTUDIO CONTEXT — Curate:\n"
            "- Before: Script wording is set (point back to Script Studio for rewrites).\n"
            "- This: finishing touches — you own music + speaking tone; they adjust by talking with you. "
            "Listen is the hero. Optional one photo; voice enrollment is Me → Voice.\n"
            "- After: Who can listen is optional password access — you never create share links.\n"
            f"- Current choices: bgm_track={bgm}, narration_tone={tone}, "
            f"unique_bed={'yes' if has_unique else 'no'}, "
            f"photo={'yes' if has_photo else 'no'}.\n"
            f"- Voice: enrolled={'yes' if voice.get('enrolled') else 'no'}, "
            f"clone_status={voice.get('clone_status')}, "
            f"label={voice.get('label')}. "
            f"Setup path: {voice.get('setup_path') or '/me/voice'}.\n"
            "- If not enrolled: warmly suggest Me → Voice so Listen uses their voice.\n"
            "- When they ask to change music or tone, call set_curate_choice, then invite Listen again."
        )
        if script_text:
            instructions += (
                "\n\nScript excerpt (do not rewrite wholesale):\n" + script_text[:2500]
            )

    return instructions


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


@router.get("/agent-pack", response_model=AgentPackOut)
def get_agent_pack(
    mode: str = "conversing",
    conversation_id: str | None = None,
    story_id: str | None = None,
    current_user: models.User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Return instructions+tools for a mid-session Chief-of-Staff handoff (session.update)."""
    resolved = normalize_mode(mode, story_id=story_id)
    body = TokenRequest(conversation_id=conversation_id, story_id=story_id, mode=resolved)
    instructions = _build_instructions(body, current_user, db, resolved)
    return AgentPackOut(mode=resolved, instructions=instructions, tools=tools_for_mode(resolved))


def _mint_token_impl(
    body: TokenRequest,
    current_user: models.User,
    db: Session,
) -> TokenResponse:
    api_key = (settings.openai_api_key or "").strip()
    mode = normalize_mode(body.mode, story_id=body.story_id)
    if not api_key:
        return TokenResponse(
            model=realtime_model(settings.openai_realtime_model),
            stubbed=True,
            mode=mode,
        )

    model = realtime_model(settings.openai_realtime_model)
    instructions = _build_instructions(body, current_user, db, mode)
    tools = tools_for_mode(mode)

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
        mode=mode,
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
