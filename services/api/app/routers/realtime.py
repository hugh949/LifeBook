import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.config import settings, DEFAULT_FAMILY_ID
from app.db.session import get_db
from app.db import models

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/realtime", tags=["realtime"])

# Voice companion instructions (V1 spec: warm, validating, one question at a time)
# Anchored to product vision: family support group, memory bank for older adult + children/grandchildren/future generations
REALTIME_INSTRUCTIONS = """You are a warm, gentle voice companion in a family memory app. You help the person speaking feel heard and support them in saving and sharing stories with their family.
- Do not speak until the user has spoken first. Wait for them to initiate the conversation. When they connect, greet briefly and wait for their response before continuing.
- When the user ends the session (says goodbye, taps End session, or disconnects), stop speaking immediately. Do not continue talking after they have ended.
- Use a warm, validating tone. Reflect feelings first (e.g. "That sounds important to you").
- Ask one question at a time. Wait for their answer before continuing.
- Do not test memory or correct facts. Never argue about what happened.
- If they seem tired, offer to switch to music or take a break.
- Keep responses concise and easy to follow. Support multiple languages if the user switches.
- Build 4: If the user says to forget this conversation, delete what we said, or don't save this, call the forget_current_conversation tool. Then confirm briefly that this conversation will not be saved and they can tap End session when ready.
- Build 5: At appropriate times you may offer to turn our discussion into a short story and play it back. If they agree, summarize it as a warm first-person story and speak it. They can ask for changes; revise and repeat. When the user says they are happy with it (e.g. "that's good", "save it", "I like it"): (1) You MUST first SPEAK one short sentence so they know to wait—e.g. "I'm going to save your story now; it'll take a few seconds, so please wait." Do not call confirm_story until you have said this. (2) Then call the confirm_story tool with the exact final narrative text. (3) After the tool returns, SPEAK again to confirm and tell them what's next, e.g. "Done! Your story is saved. You'll find it in Recall past stories. When you're ready, you can move it to Shared Memories to share with the family." Never leave a long silence before or after saving—always give this spoken feedback.
- Voice ID (getting to know someone new): If you do not yet know who is speaking, treat it as a chance to get to know them. Say something warm like that you'd love to know what to call them and a little about what brings them here—never mention "enrollment", "voice profile", or any system. When they tell you their name, call the create_participant tool with that name exactly, then greet them by name and continue the conversation. Make it feel natural and caring, not like a form."""


class TokenRequest(BaseModel):
    participant_id: str | None = None  # Build 1: who is speaking; agent greets by name
    participant_name: str | None = None  # optional: for first-time, name they gave
    moment_id: str | None = None  # Build 3: recall this past session (inject its turns as "Recalled conversation")
    story_id: str | None = None  # Build 5: refine this story (inject story content; agent offers review/edit)


class TokenResponse(BaseModel):
    value: str | None = None  # ephemeral client secret (ek_...)
    client_secret: str | None = None  # alias for value
    model: str = "gpt-realtime"
    expires_at: int | None = None
    stubbed: bool = False


def _get_voice_context_turns(db: Session, participant_id: str, max_turns: int = 20) -> list[dict]:
    """Build 2: last N turns for this participant for continuity."""
    moments = (
        db.query(models.Moment)
        .filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "older_session",
            models.Moment.participant_id == participant_id,
            models.Moment.session_turns_json.isnot(None),
        )
        .order_by(models.Moment.created_at.asc())
        .all()
    )
    turns: list[dict] = []
    for m in moments:
        raw = m.session_turns_json or []
        if not isinstance(raw, list):
            continue
        for t in raw:
            if isinstance(t, dict) and t.get("role") in ("user", "assistant") and t.get("content"):
                turns.append({"role": t["role"], "content": str(t["content"])})
    return turns[-max_turns:]


def _get_moment_for_recall(
    db: Session, participant_id: str, moment_id: str
) -> tuple[list[dict], str | None] | None:
    """Build 3: get turns and summary for a single moment (for recall); returns None if not found or wrong participant."""
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "older_session",
            models.Moment.participant_id == participant_id,
            models.Moment.session_turns_json.isnot(None),
        )
        .first()
    )
    if not moment or not isinstance(moment.session_turns_json, list):
        return None
    turns = []
    for t in moment.session_turns_json:
        if isinstance(t, dict) and t.get("role") in ("user", "assistant") and t.get("content"):
            turns.append({"role": t["role"], "content": str(t["content"])})
    summary = getattr(moment, "summary", None)
    if isinstance(summary, str) and summary.strip():
        summary = summary.strip()
    else:
        summary = None
    return (turns, summary)


def _get_shared_stories_for_agent(db: Session, participant_id: str | None = None, limit: int = 15) -> list[dict]:
    """Build 7: list shared voice stories for conversation starter and play_story tool. When participant_id is set, include 'listened' so agent can offer 'new stories you haven't heard'."""
    moments = (
        db.query(models.Moment)
        .filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
        )
        .order_by(models.Moment.created_at.desc())
        .limit(limit)
        .all()
    )
    if not moments:
        return []
    moment_ids = [str(m.id) for m in moments]
    listened_set = set()
    if participant_id:
        rows = (
            db.query(models.SharedStoryListen.moment_id)
            .filter(
                models.SharedStoryListen.participant_id == participant_id,
                models.SharedStoryListen.moment_id.in_(moment_ids),
            )
            .all()
        )
        listened_set = {str(r.moment_id) for r in rows}
    part_ids = list({str(m.participant_id) for m in moments if m.participant_id})
    participants = {}
    if part_ids:
        for p in db.query(models.VoiceParticipant).filter(
            models.VoiceParticipant.id.in_(part_ids),
        ).all():
            participants[str(p.id)] = (p.label or "").strip() or "Someone"
    has_audio_rows = (
        db.query(models.MomentAsset.moment_id)
        .join(models.Asset, models.MomentAsset.asset_id == models.Asset.id)
        .filter(
            models.MomentAsset.moment_id.in_(moment_ids),
            models.MomentAsset.role == "session_audio",
        )
        .distinct()
        .all()
    )
    has_audio_set = {str(r.moment_id) for r in has_audio_rows}
    out = []
    for m in moments:
        mid = str(m.id)
        title = (m.title or "").strip() or (m.summary or "").strip()[:60] or "Story"
        listened = mid in listened_set if participant_id else None
        out.append({
            "moment_id": mid,
            "title": title,
            "participant_name": participants.get(str(m.participant_id or ""), "Someone"),
            "has_audio": mid in has_audio_set,
            "listened": listened,
        })
    return out


def _get_story_for_refinement(
    db: Session, participant_id: str, story_id: str
) -> tuple[str, str | None] | None:
    """Build 5: get story content for refinement; returns (draft_or_summary, title) or None."""
    story = (
        db.query(models.VoiceStory)
        .filter(
            models.VoiceStory.id == story_id,
            models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
            models.VoiceStory.participant_id == participant_id,
            models.VoiceStory.status.in_(["draft", "final"]),
        )
        .first()
    )
    if not story:
        return None
    text = (story.draft_text or "").strip() or (story.summary or "").strip()
    title = (story.title or "").strip() or None
    return (text, title) if text else (story.summary or "(No content yet)", title)


@router.post("/token", response_model=TokenResponse)
def mint_token(body: TokenRequest | None = None, db: Session = Depends(get_db)):
    try:
        return _mint_token_impl(body or TokenRequest(), db)
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("realtime/token: unhandled error: %s", e)
        return JSONResponse(
            status_code=500,
            content={"detail": str(e), "type": type(e).__name__},
        )


def _mint_token_impl(body: TokenRequest, db: Session) -> TokenResponse:
    logger.info("realtime/token: request received")
    api_key = (settings.openai_api_key or "").strip()
    if not api_key:
        logger.info("realtime/token: no OPENAI_API_KEY, returning stubbed")
        return TokenResponse(
            model=settings.openai_realtime_model or "gpt-realtime",
            stubbed=True,
        )

    model = settings.openai_realtime_model or "gpt-realtime"
    instructions = REALTIME_INSTRUCTIONS
    # Build 1: per-participant greeting
    if body.participant_id:
        participant = (
            db.query(models.VoiceParticipant)
            .filter(
                models.VoiceParticipant.id == body.participant_id,
                models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
            )
            .first()
        )
        if participant:
            name = participant.label
            instructions += (
                f"\n\nThe person speaking is {name}. You MUST greet them by name. "
                f"Start your first response with a direct greeting that says their name, e.g. 'Hi {name}, good to hear from you' or 'Hello {name}'."
            )
            logger.info("realtime/token: participant_id=%s label=%s", participant.id, participant.label)
            # Build 5: refine a story (person chose to review/edit this story)
            if body.story_id:
                story_data = _get_story_for_refinement(db, body.participant_id, body.story_id)
                if story_data:
                    story_text, story_title = story_data
                    instructions += "\n\nStory chosen for refinement (the person wants to review or change this story):\n"
                    if story_title:
                        instructions += f"Title: {story_title}\n\n"
                    instructions += story_text
                    instructions += (
                        "\n\nSTORY REFINEMENT: The person chose to work on this story. "
                        "Your first response MUST: (1) greet them by name, and (2) ask if they want to "
                        "review the story or add/change specific sections. Keep it warm and short. "
                        "Then help them refine the story based on what they say. "
                        "When they are happy with the final version: you MUST speak first—say one short sentence that you're saving and it will take a few seconds so they know to wait (e.g. 'I'm going to save your story now; please wait a moment.'); then call confirm_story with the exact story text; after the tool returns, SAY that it's saved and they can find it in Recall past stories and move it to Shared Memories when ready."
                    )
                    logger.info("realtime/token: story_id=%s refinement", body.story_id)
                else:
                    context_turns = _get_voice_context_turns(db, body.participant_id)
                    if context_turns:
                        lines = []
                        for t in context_turns:
                            who = "User" if t.get("role") == "user" else "Assistant"
                            lines.append(f"{who}: {t.get('content', '')}")
                        instructions += "\n\nPrevious context for this person (continue from where you left off):\n" + "\n".join(lines)
            # Build 3: recall a specific session (or "Turn into story" from a conversation)
            elif body.moment_id:
                recalled_data = _get_moment_for_recall(db, body.participant_id, body.moment_id)
                if recalled_data:
                    recalled, summary = recalled_data
                    lines = []
                    for t in recalled:
                        who = "User" if t.get("role") == "user" else "Assistant"
                        lines.append(f"{who}: {t.get('content', '')}")
                    block = "Recalled conversation (the user may want to revisit this or turn it into a story):\n" + "\n".join(lines)
                    if summary and summary.lower() not in ("session recorded.", "session recorded"):
                        instructions += "\n\nConversation summary: " + summary + ".\n\n" + block
                    else:
                        instructions += "\n\n" + block
                    instructions += (
                        "\n\nTURN INTO STORY: The person may want to turn this conversation into a short story. "
                        "Help them craft a warm first-person narrative from the conversation. Revise until they are happy. "
                        "When they say they are happy with it (e.g. 'that's good', 'save it'): you MUST speak first—say one short sentence that you're saving the story and it will take a few seconds so they know to wait (e.g. 'I'm going to save your story now; please wait a moment.'). Only after saying that, call confirm_story with the exact final story text; after the tool returns, SAY that it's saved and they can find it in Recall past stories and move it to Shared Memories when ready. "
                        "Do not suggest saving in the app; confirmation happens here by voice. Never leave a long silence around saving—always speak before and after."
                    )
                    instructions += (
                        "\n\nRECALLED SESSION: The person chose to continue this past conversation. "
                        "Your first response MUST: (1) greet them by name, and (2) briefly acknowledge that you're "
                        "picking up this topic again (e.g. that you're glad to continue, or that you remember what you discussed). "
                        "Then invite them to add more or go deeper. Keep it warm and short—one or two sentences. "
                        "Do not repeat the full previous conversation; just acknowledge and invite."
                    )
                    logger.info("realtime/token: moment_id=%s recalled turns=%s", body.moment_id, len(recalled))
                else:
                    context_turns = _get_voice_context_turns(db, body.participant_id)
                    if context_turns:
                        lines = []
                        for t in context_turns:
                            who = "User" if t.get("role") == "user" else "Assistant"
                            lines.append(f"{who}: {t.get('content', '')}")
                        instructions += "\n\nPrevious context for this person (continue from where you left off):\n" + "\n".join(lines)
            else:
                context_turns = _get_voice_context_turns(db, body.participant_id)
                if context_turns:
                    lines = []
                    for t in context_turns:
                        who = "User" if t.get("role") == "user" else "Assistant"
                        lines.append(f"{who}: {t.get('content', '')}")
                    instructions += "\n\nPrevious context for this person (continue from where you left off):\n" + "\n".join(lines)
        else:
            instructions += "\n\nYou do not yet know who is speaking. Have a brief, warm getting-to-know-you: ask what you should call them and what brings them here. When they tell you their name, call create_participant with that name. Be empathic; never mention systems or technical steps."
    else:
        instructions += "\n\nYou do not yet know who is speaking. Have a brief, warm getting-to-know-you: ask what you should call them and what brings them here. When they tell you their name, call create_participant with that name. Be empathic; never mention systems or technical steps."

    # Build 7: shared family stories — conversation starter and play_story tool
    shared_stories = _get_shared_stories_for_agent(db, participant_id=body.participant_id)
    playable = [s for s in shared_stories if s.get("has_audio")]
    if playable:
        new_stories = [s for s in playable if s.get("listened") is False]
        lines = []
        for s in playable:
            new_label = " (new—not listened yet)" if s.get("listened") is False else ""
            lines.append(f"- moment_id {s['moment_id']}: {s['participant_name']} — {s['title']}{new_label}")
        instructions += (
            "\n\nShared family stories (memory bank). "
        )
        if new_stories and body.participant_id:
            instructions += (
                "You MAY offer at the start: 'Would you like a snapshot of new family stories you may not have listened to yet?' "
                "There are " + str(len(new_stories)) + " new story/stories for this person. "
            )
        instructions += (
            "When the user asks to play one (e.g. 'play Sarah's story' or 'play the one about X'), "
            "call the play_story tool with that story's moment_id. List of playable stories:\n"
            + "\n".join(lines)
        )

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
        },
    }
    # Build 4: forget_current_conversation; Build 7: play_story; Voice ID: create_participant
    tools = [
        {
            "type": "function",
            "name": "forget_current_conversation",
            "description": "Call when the user asks to forget this conversation, delete what we said, or not save this conversation. After calling, confirm that this conversation will not be saved.",
            "parameters": {"type": "object", "properties": {}},
        },
        {
            "type": "function",
            "name": "create_participant",
            "description": "Call when the user has told you their name and you want to remember them. Use the exact name they said (e.g. Sarah, James). Only call once per person per session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {
                        "type": "string",
                        "description": "The name the person asked you to call them (e.g. Sarah, Dad, James).",
                    },
                },
                "required": ["name"],
            },
        },
        {
            "type": "function",
            "name": "confirm_story",
            "description": "Call when the user has approved the narrated story and said they are happy with it (e.g. that's good, save it, I like it). You MUST speak first before calling this tool: say one short sentence that you're saving their story and it will take a few seconds so they know to wait (e.g. 'I'm going to save your story now; please wait a moment.'). Only after you have spoken that, call confirm_story. AFTER the tool returns: you will receive a new turn; you MUST immediately speak to the user: confirm the story is saved, that they can find it in Recall past stories, and when ready they can move it to Shared Memories to share with the family. Do not wait for the user to speak—speak as soon as you get the tool result. Provide the final narrative text in story_text.",
            "parameters": {
                "type": "object",
                "properties": {
                    "story_text": {
                        "type": "string",
                        "description": "The exact final narrative text of the story as agreed with the user (the story you spoke or the refined version).",
                    },
                },
                "required": ["story_text"],
            },
        },
    ]
    if playable:
        tools.append({
            "type": "function",
            "name": "play_story",
            "description": "Play a shared family story by its moment_id. Call when the user asks to play a story (e.g. 'play Sarah's story' or 'the one about X').",
            "parameters": {
                "type": "object",
                "properties": {
                    "moment_id": {
                        "type": "string",
                        "description": "The moment id of the shared story to play (from the shared stories list).",
                    },
                },
                "required": ["moment_id"],
            },
        })
    payload["session"]["tools"] = tools
    payload["session"]["tool_choice"] = "auto"

    try:
        logger.info("realtime/token: calling OpenAI client_secrets (model=%s)", model)
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
