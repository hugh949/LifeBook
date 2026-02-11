"""Voice participant and context (Build 1: identity, Build 2: continuity)."""
import hashlib
import logging
import re
from datetime import datetime, timezone
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.azure_storage import generate_upload_sas, signed_read_url
from app.core.config import DEFAULT_FAMILY_ID, settings
from app.db import models
from app.db.session import get_db
from app.services.ai_recall import generate_narrate_music_prompt, generate_story_title, generate_narrate_mood
from app.services.audio_convert import to_wav_16k_mono, normalize_lufs_mp3, NARRATION_LUFS, BGM_LUFS
from app.services.music_generation import generate_bgm_audio
from app.services.speaker_recognition import (
    create_enrollment as azure_create_enrollment,
    create_profile as azure_create_profile,
    identify_single_speaker as azure_identify_single_speaker,
    is_available as azure_speaker_recognition_available,
)
from app.services import speaker_recognition_eagle


def speaker_recognition_available() -> bool:
    """True if Voice ID is configured (Eagle or Azure per VOICE_ID_BACKEND)."""
    backend = (settings.voice_id_backend or "eagle").strip().lower()
    if backend == "azure":
        return azure_speaker_recognition_available()
    return speaker_recognition_eagle.is_available()

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice", tags=["voice"])

MAX_CONTEXT_TURNS = 20  # last N turns across recent sessions for continuity
MAX_SUMMARY_CHARS = 100
RECALL_LABEL_SUMMARY_CHARS = 60  # first N chars of participant summary in recall label
MIN_TOPIC_WORD_LEN = 4  # prefer longer, more noun-like words
MAX_TAGS = 6
SKIP_FIRST_N_WORDS = 3  # skip "I want to ask" etc when extracting topic words

# Words to exclude from topic tags: greetings, fillers, niceties, and common non-nouns
# so recall tags are noun-like and from what the participant said (e.g. "wedding", "doctor", "medication")
TOPIC_STOPWORDS = frozenset({
    "a", "an", "the", "and", "or", "but", "if", "then", "so", "its", "it's", "to", "from",
    "i", "me", "my", "you", "your", "he", "she", "we", "they", "them", "us", "our", "his", "her",
    "is", "are", "was", "were", "be", "been", "being", "have", "has", "had", "do", "does", "did",
    "will", "would", "could", "should", "may", "might", "can", "just", "really", "very",
    "hello", "hi", "hey", "yes", "no", "ok", "okay", "well", "oh", "ah", "um", "uh",
    "nice", "good", "great", "lovely", "wonderful", "hear", "speak", "talking", "talk",
    "older", "adult", "today", "now", "here", "there", "this", "that", "these", "those",
    "what", "when", "where", "which", "who", "how", "why", "about", "with", "for", "not",
    # Niceties and filler
    "thank", "thanks", "thankyou", "gonna", "wanna", "gotta", "also", "more",
    # Common non-nouns so tags lean toward nouns (participant topics)
    "help", "like", "voice", "feeling", "mind", "doing", "right", "whats", "want", "think",
    "know", "get", "see", "come", "go", "say", "make", "take", "need", "try", "ask", "tell",
    "give", "work", "call", "find", "feel", "seem", "seems", "thing", "things", "way", "day",
    "youre", "sarah",
})

# Short phrases that are only niceties/greetings; don't use as recall summary (use next substantive message)
NICETY_PREFIXES = ("thank you", "thanks", "thank you.", "thanks.", "ok", "okay", "hi ", "hello ", "hey ", "yes.", "no.", "yeah", "yep", "sure.")
MAX_NICETY_LEN = 25  # treat first message as nicety if it's this short and matches


def _normalize_content(raw: object) -> str:
    """Extract plain text from content that may be string or list of parts (e.g. [{"text": "..."}])."""
    if raw is None:
        return ""
    if isinstance(raw, str):
        return raw.strip()
    if isinstance(raw, list):
        parts = []
        for p in raw:
            if isinstance(p, dict):
                if isinstance(p.get("text"), str):
                    parts.append(p["text"].strip())
                if isinstance(p.get("transcript"), str):
                    parts.append(p["transcript"].strip())
        return " ".join(parts).strip()
    return str(raw).strip()


def _topic_words_from_text(text: str, max_tags: int = MAX_TAGS) -> list[str]:
    """Extract noun-like topic words from text; skip first few words (e.g. 'I want to ask')."""
    if not (text or "").strip():
        return []
    words = text.split()
    start = min(SKIP_FIRST_N_WORDS, len(words))
    seen = set()
    tags = []
    for w in words[start:]:
        if len(tags) >= max_tags:
            break
        clean = "".join(c for c in w if c.isalnum() or c in "'-").lower()
        if len(clean) < MIN_TOPIC_WORD_LEN or clean in TOPIC_STOPWORDS or clean in seen:
            continue
        seen.add(clean)
        tags.append(clean)
    return tags


def _is_nicety_only(msg: str) -> bool:
    """True if message is only a short nicety/greeting (don't use as recall summary)."""
    s = (msg or "").strip().lower()
    if len(s) > MAX_NICETY_LEN:
        return False
    return s.startswith(NICETY_PREFIXES) or s in ("thank you", "thanks", "ok", "okay", "hi", "hello", "hey", "yes", "no", "yeah", "yep", "sure")


def _derive_from_turns(turns_json: list | None) -> tuple[str | None, list[str]]:
    """Derive summary and topic tags from the human participant only (role user/human). Never use assistant/agent content."""
    if not turns_json or not isinstance(turns_json, list):
        return None, []
    def is_user(r: object) -> bool:
        return r in ("user", "human")
    user_messages: list[str] = []
    for t in turns_json:
        if not isinstance(t, dict):
            continue
        raw_content = t.get("content")
        role = (t.get("role") or "").strip().lower()
        if role not in ("user", "assistant", "human"):
            continue
        if not is_user(role):
            continue
        content = _normalize_content(raw_content) if raw_content is not None else ""
        if not content:
            continue
        user_messages.append(content)
    if not user_messages:
        return None, []
    # Summary: use first substantive message (skip nicety-only like "Thank you.")
    first_user = user_messages[0]
    summary_msg = first_user
    if _is_nicety_only(first_user):
        for msg in user_messages[1:]:
            if not _is_nicety_only(msg):
                summary_msg = msg
                break
        else:
            summary_msg = max(user_messages, key=len)
    summary = (
        summary_msg[:MAX_SUMMARY_CHARS].strip()
        + ("…" if len(summary_msg) > MAX_SUMMARY_CHARS else "")
    )
    # Tags from all participant text combined (solid access to everything they said)
    combined = " ".join(user_messages)
    tags = _topic_words_from_text(combined)
    return summary, tags[:MAX_TAGS]


def _participant_blocks_from_transcript(text: str) -> list[str]:
    """Parse transcript into participant-only segments. Only text explicitly labeled user/participant/human (never assistant)."""
    if not text or not text.strip():
        return []
    text = text.strip()
    # Format we save from turns: "user: ...\nassistant: ..." (lowercase)
    user_parts = re.findall(
        r"(?:user|participant|human):\s*([^\n]+(?:\n(?!(?:\s*)(?:user|participant|human|assistant|agent|ai):)[^\n]*)*)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if user_parts:
        return [p.strip() for p in user_parts if p.strip()]
    # Speaker 1 / Speaker 2 (only when explicitly labeled)
    speaker_parts = re.findall(
        r"(?:speaker\s*1|participant|speaker\s*2):\s*([^\n]+(?:\n(?!(?:\s*)(?:speaker\s*[12]|assistant|agent):)[^\n]*)*)",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if speaker_parts:
        return [p.strip() for p in speaker_parts if p.strip()]
    # Do not use unlabeled text or "first block before Assistant" – it is often the agent. Only participant-labeled segments.
    return []


def _derive_from_transcript(transcript_text: str | None) -> tuple[str | None, list[str]]:
    """Derive summary and topic tags from raw transcript. Uses participant segments only (solid access to person's words)."""
    if not transcript_text or not transcript_text.strip():
        return None, []
    blocks = _participant_blocks_from_transcript(transcript_text.strip())
    if not blocks:
        return None, []
    first = blocks[0]
    summary_msg = first
    if _is_nicety_only(first):
        for b in blocks[1:]:
            if not _is_nicety_only(b):
                summary_msg = b
                break
        else:
            summary_msg = max(blocks, key=len)
    summary = summary_msg[:MAX_SUMMARY_CHARS].strip() + ("…" if len(summary_msg) > MAX_SUMMARY_CHARS else "")
    combined = " ".join(blocks)
    tags = _topic_words_from_text(combined)
    return summary, tags[:MAX_TAGS]


class ParticipantOut(BaseModel):
    id: str
    label: str
    has_voice_profile: bool = False  # Voice ID: enrolled for recognition
    recall_passphrase_set: bool = False  # True if a spoken passphrase is set to unlock Recall lists


class ParticipantCreate(BaseModel):
    label: str  # display name, e.g. "Sarah", "James"


def _has_voice_profile(r: models.VoiceParticipant) -> bool:
    """True if participant has a voice profile usable for identification (Eagle or Azure)."""
    if getattr(r, "eagle_profile_data", None) is not None:
        return True
    pid = getattr(r, "azure_speaker_profile_id", None)
    if not pid:
        return False
    status = getattr(r, "enrollment_status", None)
    return status == "Enrolled" or status is None


@router.get("/participants", response_model=list[ParticipantOut])
def list_participants(db: Session = Depends(get_db)):
    """List voice participants for the default family (Build 1)."""
    rows = (
        db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .order_by(models.VoiceParticipant.created_at)
        .all()
    )
    return [
        ParticipantOut(
            id=r.id,
            label=r.label,
            has_voice_profile=_has_voice_profile(r),
            recall_passphrase_set=bool(getattr(r, "recall_passphrase", None) and str(r.recall_passphrase).strip()),
        )
        for r in rows
    ]


NEW_USER_LABEL = "New User"


@router.post("/participants", response_model=ParticipantOut)
def create_participant(body: ParticipantCreate, db: Session = Depends(get_db)):
    """Add a voice participant (e.g. when agent asks for name and user says 'Sarah').
    For label 'New User' we return the single shared placeholder so we never create duplicates."""
    label = (body.label or "").strip() or "Unknown"
    if label == NEW_USER_LABEL:
        existing = (
            db.query(models.VoiceParticipant)
            .filter(
                models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
                models.VoiceParticipant.label == NEW_USER_LABEL,
            )
            .order_by(models.VoiceParticipant.created_at)
            .first()
        )
        if existing:
            db.refresh(existing)
            logger.info("voice/participants: returning existing New User id=%s", existing.id)
            return ParticipantOut(
                id=existing.id,
                label=existing.label,
                has_voice_profile=_has_voice_profile(existing),
                recall_passphrase_set=bool(getattr(existing, "recall_passphrase", None) and str(existing.recall_passphrase).strip()),
            )
    participant = models.VoiceParticipant(
        family_id=DEFAULT_FAMILY_ID,
        label=label,
    )
    db.add(participant)
    db.commit()
    db.refresh(participant)
    logger.info("voice/participants: created id=%s label=%s", participant.id, participant.label)
    return ParticipantOut(
        id=participant.id,
        label=participant.label,
        has_voice_profile=_has_voice_profile(participant),
        recall_passphrase_set=bool(getattr(participant, "recall_passphrase", None) and str(participant.recall_passphrase).strip()),
    )


RECALL_PIN_PATTERN = re.compile(r"^\d{4}$")

def _hash_recall_pin(participant_id: str, code: str) -> str:
    """Hash 4-digit PIN with participant id so same PIN on different users differs."""
    return hashlib.sha256(f"{participant_id}:{code}".encode()).hexdigest()


class RecallPinSetBody(BaseModel):
    recall_pin: str  # 4-digit code


class RecallVerifyBody(BaseModel):
    code: str  # 4-digit code to verify


class RecallVerifyOut(BaseModel):
    ok: bool


@router.patch("/participants/{participant_id}", response_model=ParticipantOut)
def set_recall_pin(
    participant_id: str,
    body: RecallPinSetBody,
    db: Session = Depends(get_db),
):
    """Set the 4-digit recall code for this participant to unlock Recall lists."""
    participant = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.id == participant_id,
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    raw = (body.recall_pin or "").strip()
    if not RECALL_PIN_PATTERN.match(raw):
        raise HTTPException(status_code=400, detail="Code must be exactly 4 digits")
    participant.recall_passphrase = _hash_recall_pin(participant_id, raw)
    db.add(participant)
    db.commit()
    db.refresh(participant)
    logger.info("voice/participants: set recall_pin for id=%s", participant_id)
    return ParticipantOut(
        id=participant.id,
        label=participant.label,
        has_voice_profile=_has_voice_profile(participant),
        recall_passphrase_set=True,
    )


@router.post("/participants/{participant_id}/verify-recall", response_model=RecallVerifyOut)
def verify_recall_code(
    participant_id: str,
    body: RecallVerifyBody,
    db: Session = Depends(get_db),
):
    """Verify 4-digit code matches this participant's stored recall code."""
    participant = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.id == participant_id,
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    stored = (getattr(participant, "recall_passphrase", None) or "").strip()
    if not stored or len(stored) != 64:
        raise HTTPException(status_code=400, detail="No code set for this participant")
    raw = (body.code or "").strip()
    if not RECALL_PIN_PATTERN.match(raw):
        raise HTTPException(status_code=400, detail="Code must be exactly 4 digits")
    ok = _hash_recall_pin(participant_id, raw) == stored
    logger.info("voice/participants: verify-recall id=%s ok=%s", participant_id, ok)
    return RecallVerifyOut(ok=ok)


# --- Voice ID: identify and enroll (Azure Speaker Recognition) ---

class IdentifyOut(BaseModel):
    recognized: bool
    participant_id: str | None = None
    label: str | None = None


@router.post("/identify", response_model=IdentifyOut)
async def voice_identify(
    audio: UploadFile = File(..., description="WAV 16 kHz 16-bit mono, 4+ seconds of speech"),
    db: Session = Depends(get_db),
):
    """
    Identify the speaker from a short audio clip. Returns participant_id and label if recognized.
    Used at session start so the agent can greet by name without any visible setup.
    """
    if not speaker_recognition_available():
        return IdentifyOut(recognized=False)
    try:
        body = await audio.read()
    except Exception as e:
        logger.warning("voice/identify: read body %s", e)
        raise HTTPException(status_code=400, detail="Could not read audio")
    if len(body) < 1000:
        raise HTTPException(status_code=400, detail="Audio too short")
    content_type = getattr(audio, "content_type", "") or ""
    if not (body[:4] == b"RIFF" and body[8:12] == b"WAVE"):
        converted = to_wav_16k_mono(body, content_type)
        if converted:
            body = converted
        else:
            raise HTTPException(
                status_code=400,
                detail="Send WAV 16 kHz mono, or install ffmpeg on the server to accept webm/other formats",
            )

    backend = (settings.voice_id_backend or "eagle").strip().lower()
    if backend == "eagle":
        rows = (
            db.query(models.VoiceParticipant)
            .filter(
                models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
                models.VoiceParticipant.eagle_profile_data.isnot(None),
            )
            .all()
        )
        if not rows:
            return IdentifyOut(recognized=False)
        participants_with_profiles = [(str(r.id), bytes(r.eagle_profile_data)) for r in rows]
        matched_id = speaker_recognition_eagle.identify_single_speaker(participants_with_profiles, body)
        if not matched_id:
            return IdentifyOut(recognized=False)
        p = next((r for r in rows if str(r.id) == matched_id), None)
        if not p:
            return IdentifyOut(recognized=False)
        return IdentifyOut(
            recognized=True,
            participant_id=str(p.id),
            label=(p.label or "").strip() or "Someone",
        )

    # Azure path
    rows = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
            models.VoiceParticipant.azure_speaker_profile_id.isnot(None),
        )
        .all()
    )
    profile_to_participant = {
        str(r.azure_speaker_profile_id): r
        for r in rows
        if getattr(r, "enrollment_status", None) in ("Enrolled", None)
    }
    profile_ids = list(profile_to_participant.keys())
    if not profile_ids:
        return IdentifyOut(recognized=False)
    matched_profile_id = azure_identify_single_speaker(profile_ids, body)
    if not matched_profile_id:
        return IdentifyOut(recognized=False)
    p = profile_to_participant.get(matched_profile_id)
    if not p:
        return IdentifyOut(recognized=False)
    return IdentifyOut(
        recognized=True,
        participant_id=str(p.id),
        label=(p.label or "").strip() or "Someone",
    )


class EnrollOut(BaseModel):
    ok: bool
    message: str
    remaining_speech_sec: float | None = None  # if still enrolling


@router.post("/participants/{participant_id}/enroll", response_model=EnrollOut)
async def enroll_participant_voice(
    participant_id: str,
    audio: UploadFile = File(..., description="WAV 16 kHz 16-bit mono; 20+ sec of speech for full enrollment"),
    db: Session = Depends(get_db),
):
    """
    Enroll the participant's voice using the provided audio (e.g. from the getting-to-know-you conversation).
    Call after creating the participant; the same conversation audio is used so no separate step is visible.
    """
    if not speaker_recognition_available():
        return EnrollOut(ok=False, message="Voice recognition not configured")
    participant = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.id == participant_id,
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found")
    try:
        body = await audio.read()
    except Exception as e:
        logger.warning("voice/enroll: read body %s", e)
        raise HTTPException(status_code=400, detail="Could not read audio")
    if len(body) < 2000:
        raise HTTPException(status_code=400, detail="Audio too short; need more speech for enrollment")
    content_type = getattr(audio, "content_type", "") or ""
    if not (body[:4] == b"RIFF" and body[8:12] == b"WAVE"):
        converted = to_wav_16k_mono(body, content_type)
        if converted:
            body = converted
        else:
            raise HTTPException(
                status_code=400,
                detail="Send WAV 16 kHz mono, or install ffmpeg on the server to accept webm/other formats",
            )

    backend = (settings.voice_id_backend or "eagle").strip().lower()
    if backend == "eagle":
        result = speaker_recognition_eagle.enroll_participant(participant, body, db)
        db.commit()
        db.refresh(participant)
        return EnrollOut(
            ok=result.get("ok", False),
            message=result.get("message", "Enrollment failed"),
            remaining_speech_sec=result.get("remaining_speech_sec"),
        )

    # Azure path
    profile_id = getattr(participant, "azure_speaker_profile_id", None)
    if not profile_id:
        profile_id = azure_create_profile()
        if not profile_id:
            return EnrollOut(ok=False, message="Could not create voice profile")
        participant.azure_speaker_profile_id = profile_id
        db.commit()
        db.refresh(participant)
    result = azure_create_enrollment(profile_id, body)
    if not result:
        return EnrollOut(ok=False, message="Enrollment request failed")
    remaining = result.get("remainingEnrollmentsSpeechLengthInSec")
    status = result.get("enrollmentStatus", "")
    participant.enrollment_status = status
    db.commit()
    db.refresh(participant)
    return EnrollOut(
        ok=True,
        message="Enrolled" if status == "Enrolled" else "Enrolling (add more speech for best recognition)",
        remaining_speech_sec=float(remaining) if remaining is not None else None,
    )


class TurnOut(BaseModel):
    role: str
    content: str


class VoiceContextOut(BaseModel):
    turns: list[TurnOut]


@router.get("/context", response_model=VoiceContextOut)
def get_voice_context(
    participant_id: str = Query(..., description="Participant to load context for"),
    db: Session = Depends(get_db),
):
    """Return last N conversation turns for this participant (Build 2: continuity)."""
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
    turns: list[TurnOut] = []
    for m in moments:
        raw = m.session_turns_json or []
        if not isinstance(raw, list):
            continue
        for t in raw:
            if isinstance(t, dict) and "role" in t and "content" in t:
                role = str(t.get("role", "user"))
                content = str(t.get("content", ""))
                if role in ("user", "assistant") and content:
                    turns.append(TurnOut(role=role, content=content))
    turns = turns[-MAX_CONTEXT_TURNS:]  # keep last N (most recent)
    return VoiceContextOut(turns=turns)


class SessionSummaryOut(BaseModel):
    """Build 3: one past session for recall list (latest first)."""
    id: str
    summary: str | None
    title: str | None
    created_at: str  # ISO; frontend formats as e.g. 12-Apr-2026 3.20pm
    reminder_tags: list[str]  # topic words from participant
    recall_label: str | None  # one line: summary snippet + topic words (so user can pick the right conversation)


@router.get("/sessions", response_model=list[SessionSummaryOut])
def list_voice_sessions(
    participant_id: str = Query(..., description="Participant to list sessions for"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List past voice sessions for this participant, newest first (Build 3: recall on demand)."""
    moments = (
        db.query(models.Moment)
        .filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "older_session",
            models.Moment.participant_id == participant_id,
            models.Moment.deleted_at.is_(None),
        )
        .order_by(models.Moment.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for m in moments:
        created = m.created_at.isoformat() if m.created_at else ""
        turns = getattr(m, "session_turns_json", None)
        turns_len = len(turns) if isinstance(turns, list) else 0
        derived_summary, derived_tags = _derive_from_turns(turns)
        source = "none"
        if not derived_summary and not derived_tags:
            transcript = (
                db.query(models.Transcript)
                .filter(models.Transcript.moment_id == m.id)
                .first()
            )
            if transcript:
                raw = (transcript.text_en or transcript.text or "").strip()
                raw_len = len(raw)
                derived_summary, derived_tags = _derive_from_transcript(raw)
                logger.info(
                    "voice/sessions: [recall-debug] moment_id=%s transcript_len=%s derived_summary=%s derived_tags=%s",
                    m.id,
                    raw_len,
                    (derived_summary[:60] + "…") if derived_summary and len(derived_summary) > 60 else derived_summary,
                    derived_tags,
                )
                if derived_summary or derived_tags:
                    source = "transcript"
            else:
                logger.info(
                    "voice/sessions: [recall-debug] moment_id=%s turns_len=%s derived=(none) no_transcript",
                    m.id,
                    turns_len,
                )
        else:
            source = "turns"
            logger.info(
                "voice/sessions: [recall-debug] moment_id=%s turns_len=%s from_turns summary=%s tags=%s",
                m.id,
                turns_len,
                (derived_summary[:60] + "…") if derived_summary and len(derived_summary) > 60 else derived_summary,
                derived_tags,
            )
        # Prefer stored AI-derived summary and tags (from session complete) when present
        stored_tags = m.tags_json if isinstance(m.tags_json, list) else []
        stored_tags = [str(t).strip() for t in stored_tags if str(t).strip()][:10]
        stored_summary = (m.summary or "").strip() or None
        if stored_tags:
            summary = stored_summary or derived_summary
            reminder_tags = stored_tags
            source = "stored" if source == "none" else source
        elif derived_summary or derived_tags:
            summary = derived_summary
            reminder_tags = list(derived_tags)
        else:
            reminder_tags = stored_tags
            summary = stored_summary
        title = (m.title or "").strip() or None
        recall_label = None
        head = (summary or "").strip()
        if head and len(head) > RECALL_LABEL_SUMMARY_CHARS:
            head = head[:RECALL_LABEL_SUMMARY_CHARS].rstrip() + "…"
        if reminder_tags:
            recall_label = f"{head} – {', '.join(reminder_tags[:4])}" if head else ", ".join(reminder_tags[:4])
        elif head:
            recall_label = head
        if not recall_label and summary:
            recall_label = summary.strip()[:RECALL_LABEL_SUMMARY_CHARS]
            if len(summary.strip()) > RECALL_LABEL_SUMMARY_CHARS:
                recall_label = recall_label.rstrip() + "…"
        logger.info(
            "voice/sessions: [recall-debug] moment_id=%s source=%s recall_label=%s",
            m.id,
            source,
            (recall_label[:80] + "…") if recall_label and len(recall_label) > 80 else recall_label,
        )
        out.append(SessionSummaryOut(
            id=m.id,
            summary=summary,
            title=title,
            created_at=created,
            reminder_tags=reminder_tags,
            recall_label=recall_label,
        ))
    return out


@router.delete("/sessions/{moment_id}")
def delete_voice_session(
    moment_id: str,
    participant_id: str = Query(..., description="Participant whose list this session belongs to"),
    db: Session = Depends(get_db),
):
    """Soft-delete a voice session so it no longer appears in the recall list. Explicit, manual delete only."""
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "older_session",
            models.Moment.participant_id == participant_id,
            models.Moment.deleted_at.is_(None),
        )
        .first()
    )
    if not moment:
        raise HTTPException(status_code=404, detail="Session not found or already removed.")
    moment.deleted_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("voice/sessions: deleted (soft) moment_id=%s participant_id=%s", moment_id, participant_id)
    return {"deleted": True}


# --- Build 5: Recall past stories (private list; shared = memory bank) ---

class StorySummaryOut(BaseModel):
    """One story in the 'Recall past stories' list (draft/final only; shared stories are in memory bank)."""
    id: str
    title: str | None
    summary: str | None
    status: str  # draft | final
    reminder_tags: list[str]
    created_at: str


class CreateStoryBody(BaseModel):
    moment_id: str
    participant_id: str


class ConfirmStoryBody(BaseModel):
    """Create a confirmed (final) story from agent + user approval. Only way to get a story into Recall past stories."""
    participant_id: str
    story_text: str
    source_moment_id: str | None = None  # set when user chose "Turn into story" from a conversation


@router.post("/stories/confirm", response_model=StorySummaryOut)
def confirm_story(body: ConfirmStoryBody, db: Session = Depends(get_db)):
    """Create a final story when the user has confirmed the narrated story (via voice agent tool)."""
    participant_id = (body.participant_id or "").strip()
    story_text = (body.story_text or "").strip()
    if not participant_id or not story_text:
        raise HTTPException(status_code=400, detail="participant_id and story_text are required.")
    participant = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.id == participant_id,
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found.")
    source_moment_id = (body.source_moment_id or "").strip() or None
    tags = []
    if source_moment_id:
        moment = (
            db.query(models.Moment)
            .filter(
                models.Moment.id == source_moment_id,
                models.Moment.family_id == DEFAULT_FAMILY_ID,
                models.Moment.participant_id == participant_id,
                models.Moment.deleted_at.is_(None),
            )
            .first()
        )
        if moment and isinstance(getattr(moment, "tags_json", None), list):
            tags = [str(t).strip() for t in moment.tags_json if str(t).strip()][:10]
    api_key = (getattr(settings, "openai_api_key", None) or "").strip()
    model = (getattr(settings, "openai_text_model", None) or "").strip() or "gpt-4o-mini"
    title = generate_story_title(story_text, api_key, model) if story_text else None
    if not title:
        title = "Voice story"
    story = models.VoiceStory(
        family_id=DEFAULT_FAMILY_ID,
        participant_id=participant_id,
        source_moment_id=source_moment_id or None,
        title=title,
        summary=story_text[:500] if story_text else None,
        tags_json=tags if tags else None,
        draft_text=story_text,
        status="final",
    )
    db.add(story)
    db.commit()
    db.refresh(story)
    reminder_tags = (story.tags_json or []) if isinstance(story.tags_json, list) else []
    reminder_tags = [str(t).strip() for t in reminder_tags if str(t).strip()][:10]
    logger.info(
        "voice/stories: confirmed story_id=%s participant_id=%s source_moment_id=%s",
        story.id,
        participant_id,
        source_moment_id,
    )
    return StorySummaryOut(
        id=story.id,
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        status=story.status,
        reminder_tags=reminder_tags,
        created_at=story.created_at.isoformat() if story.created_at else "",
    )


@router.post("/stories", response_model=StorySummaryOut)
def create_voice_story(body: CreateStoryBody, db: Session = Depends(get_db)):
    """Create a draft story from a past conversation (moment). Copies title, summary, tags from the moment."""
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == body.moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "older_session",
            models.Moment.participant_id == body.participant_id,
            models.Moment.deleted_at.is_(None),
        )
        .first()
    )
    if not moment:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    title = (moment.title or "").strip() or "Voice story"
    summary = (moment.summary or "").strip()
    if summary and summary.lower() in ("session recorded.", "session recorded"):
        summary = None
    tags = moment.tags_json if isinstance(moment.tags_json, list) else []
    tags = [str(t).strip() for t in tags if str(t).strip()][:10]
    story = models.VoiceStory(
        family_id=DEFAULT_FAMILY_ID,
        participant_id=body.participant_id,
        source_moment_id=moment.id,
        title=title or None,
        summary=summary or None,
        tags_json=tags if tags else None,
        draft_text=summary,  # use summary as initial draft
        status="draft",
    )
    db.add(story)
    db.commit()
    db.refresh(story)
    logger.info(
        "voice/stories: created story_id=%s from moment_id=%s participant_id=%s",
        story.id,
        body.moment_id,
        body.participant_id,
    )
    return StorySummaryOut(
        id=story.id,
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        status=story.status,
        reminder_tags=tags,
        created_at=story.created_at.isoformat() if story.created_at else "",
    )


@router.get("/stories", response_model=list[StorySummaryOut])
def list_voice_stories(
    participant_id: str = Query(..., description="Participant whose stories to list"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List private stories for this participant (confirmed/final only). Shared stories appear in the memory bank."""
    rows = (
        db.query(models.VoiceStory)
        .filter(
            models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
            models.VoiceStory.participant_id == participant_id,
            models.VoiceStory.status == "final",
        )
        .order_by(models.VoiceStory.created_at.desc())
        .limit(limit)
        .all()
    )
    out = []
    for r in rows:
        tags = r.tags_json if isinstance(r.tags_json, list) else []
        reminder_tags = [str(t).strip() for t in tags if str(t).strip()][:10]
        out.append(
            StorySummaryOut(
                id=r.id,
                title=(r.title or "").strip() or None,
                summary=(r.summary or "").strip() or None,
                status=r.status,
                reminder_tags=reminder_tags,
                created_at=r.created_at.isoformat() if r.created_at else "",
            )
        )
    return out


class PatchStoryBody(BaseModel):
    title: str | None = None
    summary: str | None = None


@router.patch("/stories/{story_id}", response_model=StorySummaryOut)
def patch_voice_story(
    story_id: str,
    participant_id: str = Query(..., description="Participant whose story this is"),
    body: PatchStoryBody | None = None,
    db: Session = Depends(get_db),
):
    """Update a story's title or summary (e.g. edit AI-generated title before sharing)."""
    b = body or PatchStoryBody()
    story = (
        db.query(models.VoiceStory)
        .filter(
            models.VoiceStory.id == story_id,
            models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
            models.VoiceStory.participant_id == participant_id,
            models.VoiceStory.status == "final",
        )
        .first()
    )
    if not story:
        raise HTTPException(status_code=404, detail="Story not found or already shared.")
    if b.title is not None:
        story.title = (b.title or "").strip() or None
    if b.summary is not None:
        story.summary = (b.summary or "").strip() or None
    db.add(story)
    db.commit()
    db.refresh(story)
    tags = story.tags_json if isinstance(story.tags_json, list) else []
    reminder_tags = [str(t).strip() for t in tags if str(t).strip()][:10]
    logger.info("voice/stories: patched story_id=%s participant_id=%s", story_id, participant_id)
    return StorySummaryOut(
        id=story.id,
        title=(story.title or "").strip() or None,
        summary=(story.summary or "").strip() or None,
        status=story.status,
        reminder_tags=reminder_tags,
        created_at=story.created_at.isoformat() if story.created_at else "",
    )


@router.delete("/stories/{story_id}")
def delete_voice_story(
    story_id: str,
    participant_id: str = Query(..., description="Participant whose story this is"),
    db: Session = Depends(get_db),
):
    """Delete a private story. Only final; shared stories are in memory bank."""
    story = (
        db.query(models.VoiceStory)
        .filter(
            models.VoiceStory.id == story_id,
            models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
            models.VoiceStory.participant_id == participant_id,
            models.VoiceStory.status == "final",
        )
        .first()
    )
    if not story:
        raise HTTPException(status_code=404, detail="Story not found or already shared.")
    db.delete(story)
    db.commit()
    logger.info("voice/stories: deleted story_id=%s participant_id=%s", story_id, participant_id)
    return {"deleted": True}


# --- Build 7: List and play shared stories (memory bank) ---

class SharedStoryOut(BaseModel):
    """One shared story for family (from memory bank)."""
    id: str  # moment_id for playback
    title: str | None
    summary: str | None
    reaction_log: str | None = None  # family reactions (separate from story; not narrated)
    participant_id: str | None  # author; None if legacy
    participant_name: str
    created_at: str
    has_audio: bool
    listened: bool | None = None  # True if this participant has listened; None when participant_id not provided


@router.get("/stories/shared", response_model=list[SharedStoryOut])
def list_shared_stories(
    participant_id: str | None = Query(None, description="If set, include 'listened' per story for this participant"),
    new_only: bool = Query(False, description="If true and participant_id set, return only stories not yet listened by that participant"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db),
):
    """List shared voice stories for the family (memory bank). For conversation starter and play via voice."""
    moments = (
        db.query(models.Moment)
        .filter(
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
            models.Moment.shared_at.isnot(None),
            models.Moment.deleted_at.is_(None),
        )
        .order_by(models.Moment.created_at.desc())
        .limit(limit * 2 if new_only and participant_id else limit)
        .all()
    )
    if not moments:
        return []
    # Backfill participant_id for legacy shared moments (so list and delete show correct author)
    backfilled = False
    for m in moments:
        if m.participant_id is None:
            story = (
                db.query(models.VoiceStory)
                .filter(
                    models.VoiceStory.shared_moment_id == m.id,
                    models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
                )
                .first()
            )
            if story and story.participant_id:
                m.participant_id = story.participant_id
                db.add(m)
                backfilled = True
    if backfilled:
        try:
            db.commit()
        except Exception:
            db.rollback()
    moment_ids = [str(m.id) for m in moments]
    # Listened set for this participant
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
    if new_only and participant_id:
        moments = [m for m in moments if str(m.id) not in listened_set]
        moment_ids = [str(m.id) for m in moments]
    # Participant labels
    part_ids = list({str(m.participant_id) for m in moments if m.participant_id})
    participants = {}
    if part_ids:
        for p in db.query(models.VoiceParticipant).filter(
            models.VoiceParticipant.id.in_(part_ids),
        ).all():
            participants[str(p.id)] = (p.label or "").strip() or "Someone"
    # Which moments have session_audio
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
        listened = mid in listened_set if participant_id else None
        out.append(
            SharedStoryOut(
                id=mid,
                title=(m.title or "").strip() or None,
                summary=(m.summary or "").strip() or None,
                reaction_log=(getattr(m, "reaction_log", None) or "").strip() or None,
                participant_id=str(m.participant_id) if m.participant_id else None,
                participant_name=participants.get(str(m.participant_id or ""), "Someone"),
                created_at=m.created_at.isoformat() if m.created_at else "",
                has_audio=mid in has_audio_set,
                listened=listened,
            )
        )
    return out[:limit]


class MarkListenedBody(BaseModel):
    participant_id: str
    moment_id: str


class NarrateBody(BaseModel):
    """Text to speak with OpenAI TTS (same voice as voice agent)."""
    text: str


class NarrateMoodOut(BaseModel):
    """Deprecated: use POST /narrate/bgm for synthetic BGM. AI-chosen track for static BGM."""
    mood: str
    music_brief: str = ""


class NarrateBgmBody(BaseModel):
    """Request synthetic BGM for narration; cached per moment_id."""
    moment_id: str
    text: str


class NarrateBgmOut(BaseModel):
    """Signed playback URL for generated BGM, or null if unavailable."""
    url: str | None


@router.post("/narrate/bgm", response_model=NarrateBgmOut)
def narrate_bgm(body: NarrateBgmBody, db: Session = Depends(get_db)):
    """Return BGM URL for this story. Cache hit: instant. Cache miss: generate via LLM + ElevenLabs Music, normalize to -24 LUFS, upload to Azure, cache and return. Returns url=null if ELEVENLABS_API_KEY or Azure not set or generation fails."""
    moment_id = (body.moment_id or "").strip()
    text = (body.text or "").strip()[:6000]
    if not moment_id:
        return NarrateBgmOut(url=None)
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
            models.Moment.shared_at.isnot(None),
            models.Moment.deleted_at.is_(None),
        )
        .first()
    )
    if not moment:
        return NarrateBgmOut(url=None)
    # Cache lookup
    cached = (
        db.query(models.NarrateBgmCache)
        .filter(models.NarrateBgmCache.moment_id == moment_id)
        .first()
    )
    if cached:
        asset = db.query(models.Asset).filter(models.Asset.id == cached.asset_id).first()
        if asset and asset.blob_url:
            key = (getattr(settings, "azure_storage_account_key", None) or "").strip()
            url = signed_read_url(asset.blob_url, key, expiry_minutes=settings.read_sas_ttl_minutes)
            return NarrateBgmOut(url=url)
    # Generate: LLM prompt -> MusicGen -> upload -> Asset -> cache
    api_key = (getattr(settings, "openai_api_key", None) or "").strip()
    model = (getattr(settings, "openai_text_model", None) or "").strip() or "gpt-4o-mini"
    elevenlabs_key = (getattr(settings, "elevenlabs_api_key", None) or "").strip()
    if not elevenlabs_key:
        logger.info("voice/narrate/bgm: ELEVENLABS_API_KEY not set, skipping generation")
        return NarrateBgmOut(url=None)
    prompt = generate_narrate_music_prompt(text, api_key, model)
    audio_bytes = generate_bgm_audio(prompt, api_key=elevenlabs_key)
    if not audio_bytes:
        return NarrateBgmOut(url=None)
    normalized_bgm = normalize_lufs_mp3(audio_bytes, BGM_LUFS)
    if normalized_bgm:
        audio_bytes = normalized_bgm
    # Upload to Azure
    account = (getattr(settings, "azure_storage_account", None) or "").strip()
    key = (getattr(settings, "azure_storage_account_key", None) or "").strip()
    if not account or not key:
        logger.warning("voice/narrate/bgm: Azure storage not configured, cannot store BGM")
        return NarrateBgmOut(url=None)
    container = getattr(settings, "audio_container", "audio") or "audio"
    blob_name = f"narration-bgm/{uuid4()}.mp3"
    try:
        blob_url, upload_url = generate_upload_sas(
            account_name=account,
            account_key=key,
            container=container,
            blob_name=blob_name,
            expiry_minutes=settings.sas_ttl_minutes,
        )
        with httpx.Client(timeout=30.0) as client:
            r = client.put(upload_url, content=audio_bytes, headers={"x-ms-blob-type": "BlockBlob"})
            r.raise_for_status()
    except Exception as e:
        logger.warning("voice/narrate/bgm: Azure upload failed: %s", e)
        return NarrateBgmOut(url=None)
    # Create Asset and cache
    try:
        asset = models.Asset(
            family_id=DEFAULT_FAMILY_ID,
            type="audio",
            blob_url=blob_url,
            metadata_json={"source": "narrate_bgm", "moment_id": moment_id},
        )
        db.add(asset)
        db.flush()
        db.add(models.NarrateBgmCache(moment_id=moment_id, asset_id=asset.id))
        db.commit()
        url = signed_read_url(blob_url, key, expiry_minutes=settings.read_sas_ttl_minutes)
        return NarrateBgmOut(url=url)
    except Exception as e:
        logger.warning("voice/narrate/bgm: failed to save asset/cache: %s", e)
        db.rollback()
        return NarrateBgmOut(url=None)


@router.post("/narrate/mood", response_model=NarrateMoodOut)
def narrate_mood(body: NarrateBody):
    """Deprecated: use POST /narrate/bgm for synthetic story-unique BGM. Returns static track id (mood) for fallback."""
    api_key = (getattr(settings, "openai_api_key", None) or "").strip()
    model = (getattr(settings, "openai_text_model", None) or "").strip() or "gpt-4o-mini"
    text = (body.text or "").strip()[:6000]
    track_id, music_brief = generate_narrate_mood(text, api_key, model)
    return NarrateMoodOut(mood=track_id, music_brief=music_brief)


@router.post("/stories/shared/listened")
def mark_shared_story_listened(body: MarkListenedBody, db: Session = Depends(get_db)):
    """Mark a shared story as listened by this participant (idempotent). Call after playback."""
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == body.moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
        )
        .first()
    )
    if not moment:
        raise HTTPException(status_code=404, detail="Shared story not found.")
    participant = (
        db.query(models.VoiceParticipant)
        .filter(
            models.VoiceParticipant.id == body.participant_id,
            models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID,
        )
        .first()
    )
    if not participant:
        raise HTTPException(status_code=404, detail="Participant not found.")
    existing = (
        db.query(models.SharedStoryListen)
        .filter(
            models.SharedStoryListen.participant_id == body.participant_id,
            models.SharedStoryListen.moment_id == body.moment_id,
        )
        .first()
    )
    if not existing:
        db.add(
            models.SharedStoryListen(
                participant_id=body.participant_id,
                moment_id=body.moment_id,
            )
        )
        db.commit()
    return {"listened": True}


class DeleteSharedStoryBody(BaseModel):
    """Author must send their participant_id and recall code to delete their shared story."""
    participant_id: str
    code: str  # 4-digit recall PIN


class DeleteSharedStoryBodyWithMomentId(BaseModel):
    """Same as DeleteSharedStoryBody but moment_id in body (avoids path-encoding issues on some proxies)."""
    moment_id: str
    participant_id: str
    code: str


def _delete_shared_story_impl(moment_id: str, body: DeleteSharedStoryBody, db: Session):
    """Shared implementation for delete (path or body moment_id)."""
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source == "voice_story",
            models.Moment.shared_at.isnot(None),
            models.Moment.deleted_at.is_(None),
        )
        .first()
    )
    if not moment:
        raise HTTPException(
            status_code=404,
            detail="Shared story not found. The story may have been deleted or the link is invalid.",
        )
    # Resolve author id: moment may have it, or get from linked VoiceStory (backfill may not have run)
    author_pid = (str(moment.participant_id or "") or "").strip()
    if not author_pid:
        story = (
            db.query(models.VoiceStory)
            .filter(
                models.VoiceStory.shared_moment_id == moment.id,
                models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
            )
            .first()
        )
        if story and story.participant_id:
            author_pid = (str(story.participant_id) or "").strip()
    author_id = author_pid.lower() if author_pid else ""
    body_id_raw = (body.participant_id or "").strip()
    body_id = body_id_raw.lower()
    if not body_id:
        raise HTTPException(status_code=400, detail="participant_id is required.")
    if author_id != body_id:
        raise HTTPException(status_code=403, detail="Only the author can delete this story.")
    # Resolve participant in Python so DB/collation quirks (e.g. Azure Postgres) cannot cause 404
    all_participants = (
        db.query(models.VoiceParticipant)
        .filter(models.VoiceParticipant.family_id == DEFAULT_FAMILY_ID)
        .all()
    )
    participant = None
    for p in all_participants:
        pid = (str(getattr(p, "id", "") or "")).strip().lower()
        if pid == body_id or (author_pid and pid == author_pid.lower()):
            participant = p
            break
    if not participant:
        raise HTTPException(
            status_code=400,
            detail="Participant not found. Make sure you are signed in as the story author (choose your name in the top bar).",
        )
    stored = (getattr(participant, "recall_passphrase", None) or "").strip()
    if not stored or len(stored) != 64:
        raise HTTPException(status_code=400, detail="No recall code set for this participant.")
    raw = (body.code or "").strip()
    if not RECALL_PIN_PATTERN.match(raw):
        raise HTTPException(status_code=400, detail="Code must be exactly 4 digits.")
    pid = str(participant.id)
    if _hash_recall_pin(pid, raw) != stored:
        raise HTTPException(status_code=401, detail="Incorrect pass code.")
    moment.deleted_at = datetime.now(timezone.utc)
    db.add(moment)
    db.commit()
    logger.info("voice/stories: deleted shared story moment_id=%s participant_id=%s", moment_id, body.participant_id)
    return {"deleted": True}


@router.get("/stories/shared/delete")
def delete_shared_story_get():
    """Diagnostic: GET returns 200 if the delete route exists. Use POST with body {moment_id, participant_id, code} to delete."""
    return {"delete_endpoint": True, "method": "POST with body: moment_id, participant_id, code"}


@router.post("/stories/shared/delete")
def delete_shared_story_by_body(
    body: DeleteSharedStoryBodyWithMomentId,
    db: Session = Depends(get_db),
):
    """Delete a shared story (moment_id in body). Preferred to avoid path-encoding issues on proxies."""
    mid = (body.moment_id or "").strip()
    if not mid:
        raise HTTPException(status_code=400, detail="moment_id is required.")
    return _delete_shared_story_impl(mid, DeleteSharedStoryBody(participant_id=body.participant_id, code=body.code), db)


@router.post("/stories/shared/{moment_id}/delete")
def delete_shared_story(
    moment_id: str,
    body: DeleteSharedStoryBody,
    db: Session = Depends(get_db),
):
    """Delete a shared story (moment_id in path). Only the author can delete; requires recall pass code."""
    return _delete_shared_story_impl(moment_id, body, db)


# OpenAI TTS: same voice as realtime agent (alloy) for Narrate Story
OPENAI_TTS_MODEL = "tts-1-hd"
OPENAI_TTS_VOICE = "alloy"
OPENAI_TTS_MAX_CHARS = 4096


@router.post("/narrate", response_class=Response)
def narrate_tts(body: NarrateBody):
    """Generate speech from text using OpenAI TTS (alloy voice, same as voice agent). Returns audio/mpeg."""
    api_key = (getattr(settings, "openai_api_key", None) or "").strip()
    if not api_key:
        raise HTTPException(status_code=503, detail="OpenAI API key not configured. Set OPENAI_API_KEY for narration.")
    text = (body.text or "").strip()[:OPENAI_TTS_MAX_CHARS]
    if not text:
        raise HTTPException(status_code=400, detail="Text is required for narration.")
    try:
        with httpx.Client(timeout=60.0) as client:
            r = client.post(
                "https://api.openai.com/v1/audio/speech",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": OPENAI_TTS_MODEL,
                    "input": text,
                    "voice": OPENAI_TTS_VOICE,
                    "response_format": "mp3",
                    "speed": 1.0,
                },
            )
        r.raise_for_status()
        content = r.content
        normalized = normalize_lufs_mp3(content, NARRATION_LUFS)
        if normalized:
            content = normalized
        return Response(content=content, media_type="audio/mpeg")
    except httpx.HTTPStatusError as e:
        logger.warning("voice/narrate: OpenAI TTS HTTP %s: %s", e.response.status_code, (e.response.text or "")[:300])
        raise HTTPException(
            status_code=min(e.response.status_code, 502),
            detail=e.response.text or "OpenAI TTS failed",
        )
    except Exception as e:
        logger.exception("voice/narrate: %s", e)
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/stories/shared/playback")
def get_shared_story_playback(
    moment_id: str = Query(..., description="Moment id of the voice story or session"),
    db: Session = Depends(get_db),
):
    """Return signed playback URL for a voice story's or voice session's audio. 404 if not found or no audio."""
    moment = (
        db.query(models.Moment)
        .filter(
            models.Moment.id == moment_id,
            models.Moment.family_id == DEFAULT_FAMILY_ID,
            models.Moment.source.in_(["voice_story", "older_session"]),
        )
        .first()
    )
    if not moment:
        raise HTTPException(status_code=404, detail="Shared story not found.")
    row = (
        db.query(models.Asset.blob_url)
        .join(models.MomentAsset, models.MomentAsset.asset_id == models.Asset.id)
        .filter(
            models.MomentAsset.moment_id == moment_id,
            models.MomentAsset.role == "session_audio",
        )
        .limit(1)
        .first()
    )
    if not row or not row.blob_url:
        raise HTTPException(status_code=404, detail="No audio for this story.")
    url = (
        signed_read_url(
            row.blob_url,
            settings.azure_storage_account_key or "",
            getattr(settings, "read_sas_ttl_minutes", 60),
        )
        if settings.azure_storage_account_key
        else row.blob_url
    )
    return {"url": url}


@router.post("/stories/{story_id}/share")
def share_voice_story(
    story_id: str,
    participant_id: str = Query(..., description="Participant whose story this is"),
    db: Session = Depends(get_db),
):
    """Move story to memory bank: create a family-visible Moment and mark story as shared. Only final stories can be shared."""
    story = (
        db.query(models.VoiceStory)
        .filter(
            models.VoiceStory.id == story_id,
            models.VoiceStory.family_id == DEFAULT_FAMILY_ID,
            models.VoiceStory.participant_id == participant_id,
            models.VoiceStory.status == "final",
        )
        .first()
    )
    if not story:
        raise HTTPException(status_code=404, detail="Story not found or already shared.")
    summary = (story.summary or "").strip() or (story.draft_text or "").strip()[:500] or None
    content_for_title = (story.draft_text or story.summary or "").strip()
    title = (story.title or "").strip() or None
    if content_for_title and not title:
        api_key = (getattr(settings, "openai_api_key", None) or "").strip()
        model = (getattr(settings, "openai_text_model", None) or "").strip() or "gpt-4o-mini"
        ai_title = generate_story_title(content_for_title, api_key, model)
        if ai_title:
            title = ai_title
    if not title:
        title = "Voice story"
    moment = models.Moment(
        family_id=DEFAULT_FAMILY_ID,
        title=title,
        summary=summary,
        source="voice_story",
        participant_id=story.participant_id,
        tags_json=story.tags_json,
        shared_at=datetime.now(timezone.utc),
    )
    db.add(moment)
    db.flush()
    if story.final_audio_asset_id:
        db.add(
            models.MomentAsset(
                moment_id=moment.id,
                asset_id=story.final_audio_asset_id,
                role="session_audio",
            )
        )
    story.status = "shared"
    story.shared_moment_id = moment.id
    db.commit()
    logger.info(
        "voice/stories: shared story_id=%s moment_id=%s participant_id=%s",
        story_id,
        moment.id,
        participant_id,
    )
    return {"shared": True, "momentId": str(moment.id)}
