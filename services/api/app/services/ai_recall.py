"""AI-derived recall label: summary and topic tags from participant text (OpenAI). Multilingual-friendly."""
import json
import logging
import re
import httpx

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You are a helper that creates short labels for voice conversation recall.
Given only what the person (the user) said in a conversation, output:
1. A one-line summary (max 15 words) of what they talked about or wanted. Use the same language as the input. No filler like "The user said...".
2. Four to six topic tags: nouns or key themes (e.g. wedding, medication, holiday). No greetings, fillers, or generic words (no "thanks", "yeah", "little", "kind"). Use the same language as the input.
Output valid JSON only, no markdown: {"summary": "...", "tags": ["tag1", "tag2", ...]}"""


def generate_recall_label(participant_text: str, api_key: str, model: str) -> tuple[str | None, list[str]]:
    """
    Call OpenAI to produce a one-line summary and topic tags from participant-only text.
    Returns (summary, tags). On failure or empty input, returns (None, []).
    Multilingual: model uses same language as input.
    """
    text = (participant_text or "").strip()
    if not text or not api_key:
        return None, []

    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text[:8000]},  # cap length
        ],
        "max_tokens": 200,
        "temperature": 0.3,
    }

    try:
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15.0,
            )
        r.raise_for_status()
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if not choice:
            return None, []
        content = (choice.get("message") or {}).get("content") or ""
        return _parse_response(content)
    except Exception as e:
        logger.warning("ai_recall: OpenAI call failed: %s", e)
        return None, []


STORY_TITLE_PROMPT = """You are a helper that creates a short, descriptive title for a family story.
Given the story text (from a voice conversation or narrative), output a single line: a title of 4 to 10 words that captures the main theme or subject. Use the same language as the input. No quotes, no "Title:", no filler.
Output only the title line, nothing else."""


def generate_story_title(story_content: str, api_key: str, model: str) -> str | None:
    """
    Call OpenAI to produce a short title (4–10 words) from story content.
    Returns the title string or None on failure/empty input.
    """
    text = (story_content or "").strip()
    if not text or not api_key:
        return None
    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": STORY_TITLE_PROMPT},
            {"role": "user", "content": text[:6000]},
        ],
        "max_tokens": 60,
        "temperature": 0.3,
    }
    try:
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15.0,
            )
        r.raise_for_status()
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if not choice:
            return None
        title = (choice.get("message") or {}).get("content") or ""
        title = title.strip().strip('"').strip()
        return title if title else None
    except Exception as e:
        logger.warning("ai_recall: generate_story_title failed: %s", e)
        return None


NARRATE_MUSIC_PROMPT_SYSTEM = """You create a short prompt for an AI music generator. The music will play softly under a spoken family story (voiceover).

Given the story text below:
1. Infer its language and cultural context (e.g. Spanish, family in Mexico; Urdu, South Asian family).
2. Infer emotional tone and atmosphere (e.g. nostalgic, tender, warm, reflective).
3. Output 1-3 sentences that describe the ideal background music. Be specific: instruments (e.g. soft piano, gentle strings), mood, tempo (e.g. 60 bpm), and cultural/language appropriateness. You MUST include: "instrumental only", "no vocals", and "suitable for voiceover" or "suitable for narration". Keep the whole prompt under 200 characters if possible."""


def generate_narrate_music_prompt(story_text: str, api_key: str, model: str) -> str:
    """
    Produce a music-generation prompt from the full story for synthetic BGM.
    Returns a short paragraph for the music model (instruments, mood, culture, voiceover-safe).
    On failure or empty input, returns a safe default prompt.
    """
    text = (story_text or "").strip()
    default_prompt = "Soft ambient piano, gentle, 60 bpm, instrumental only, no vocals, suitable for voiceover."
    if not text or not api_key:
        return default_prompt
    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": NARRATE_MUSIC_PROMPT_SYSTEM},
            {"role": "user", "content": text[:4000]},
        ],
        "max_tokens": 150,
        "temperature": 0.3,
    }
    try:
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15.0,
            )
        r.raise_for_status()
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if not choice:
            return default_prompt
        content = (choice.get("message") or {}).get("content") or ""
        prompt = content.strip().strip('"').strip()
        if not prompt or len(prompt) > 500:
            return default_prompt
        if "instrumental" not in prompt.lower() and "no vocals" not in prompt.lower():
            prompt = prompt.rstrip(".") + ". Instrumental only, no vocals, suitable for voiceover."
        return prompt
    except Exception as e:
        logger.warning("ai_recall: generate_narrate_music_prompt failed: %s", e)
        return default_prompt


# Curated tracks for narration BGM. AI reviews the full story and picks the best match.
# Each id is the track filename suffix: bg-narrate-{id}.mp3
NARRATE_TRACK_REGISTRY = [
    {"id": "reflective", "description": "Calm, thoughtful. Gentle piano or soft pads. For life reflections, wisdom, quiet contemplation, looking inward."},
    {"id": "warm", "description": "Joyful and loving. Uplifting but soft. For celebrations, family love, weddings, births, gratitude, togetherness."},
    {"id": "nostalgic", "description": "Bittersweet looking back. Melancholy but gentle. For childhood memories, past places, people no longer here, heritage."},
    {"id": "tender", "description": "Gentle sadness, comfort, care. For loss, illness, hard times, saying goodbye, or stories that need emotional holding."},
    {"id": "gentle_adventure", "description": "Light curiosity and movement. For travel, discovery, first times, small triumphs, gentle excitement."},
    {"id": "neutral", "description": "Calm and unobtrusive. For mixed or general stories where no single mood dominates, or when in doubt."},
]

NARRATE_TRACK_IDS = frozenset(t["id"] for t in NARRATE_TRACK_REGISTRY)

NARRATE_MUSIC_SELECTION_PROMPT = """You are choosing background music for a family story that will be read aloud. The music plays softly under the voice and should make the story more memorable without ever distracting from the words.

Your job: review the FULL narration below. Consider its content, situation, emotional arc, key moments, and who or what it is about. Then choose the single track that best fits—the one that will support and deepen the listener's experience.

Available tracks (reply with exactly one track id):

reflective — Calm, thoughtful. Gentle piano or soft pads. For life reflections, wisdom, quiet contemplation, looking inward.
warm — Joyful and loving. Uplifting but soft. For celebrations, family love, weddings, births, gratitude, togetherness.
nostalgic — Bittersweet looking back. Melancholy but gentle. For childhood memories, past places, people no longer here, heritage.
tender — Gentle sadness, comfort, care. For loss, illness, hard times, saying goodbye, or stories that need emotional holding.
gentle_adventure — Light curiosity and movement. For travel, discovery, first times, small triumphs, gentle excitement.
neutral — Calm and unobtrusive. For mixed or general stories where no single mood dominates, or when in doubt.

Reply with valid JSON only, no markdown: {"track_id": "<one of the ids above>", "music_brief": "<one short sentence explaining why this track fits this story>"}"""


def generate_narrate_mood(story_text: str, api_key: str, model: str) -> tuple[str, str]:
    """
    AI-driven: review the full narration and pick the best background music track.
    Returns (track_id, music_brief). track_id is one of the registry ids (e.g. reflective, warm).
    On failure or empty input, returns ("neutral", "").
    """
    text = (story_text or "").strip()
    if not text or not api_key:
        return "neutral", ""
    payload = {
        "model": model or "gpt-4o-mini",
        "messages": [
            {"role": "system", "content": NARRATE_MUSIC_SELECTION_PROMPT},
            {"role": "user", "content": text[:6000]},
        ],
        "max_tokens": 120,
        "temperature": 0.2,
    }
    try:
        with httpx.Client() as client:
            r = client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=15.0,
            )
        r.raise_for_status()
        data = r.json()
        choice = (data.get("choices") or [None])[0]
        if not choice:
            return "neutral", ""
        content = (choice.get("message") or {}).get("content") or ""
        track_id, music_brief = _parse_narrate_music_response(content)
        return track_id, music_brief
    except Exception as e:
        logger.warning("ai_recall: generate_narrate_mood failed: %s", e)
        return "neutral", ""


def _parse_narrate_music_response(content: str) -> tuple[str, str]:
    """Parse JSON { track_id, music_brief } from model output. Returns (track_id, music_brief); track_id validated against registry."""
    content = (content or "").strip()
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    try:
        obj = json.loads(content)
        raw_id = (obj.get("track_id") or "").strip().lower()
        track_id = raw_id if raw_id in NARRATE_TRACK_IDS else "neutral"
        music_brief = (obj.get("music_brief") or "").strip() or ""
        return track_id, music_brief
    except (json.JSONDecodeError, TypeError, KeyError):
        return "neutral", ""


def _parse_response(content: str) -> tuple[str | None, list[str]]:
    """Parse JSON summary + tags from model output. Tolerates markdown code blocks."""
    content = (content or "").strip()
    # Strip markdown code block if present
    if content.startswith("```"):
        content = re.sub(r"^```(?:json)?\s*", "", content)
        content = re.sub(r"\s*```$", "", content)
    try:
        obj = json.loads(content)
        summary = (obj.get("summary") or "").strip() or None
        raw_tags = obj.get("tags")
        if isinstance(raw_tags, list):
            tags = [str(t).strip() for t in raw_tags if str(t).strip()][:6]
        else:
            tags = []
        return summary, tags
    except (json.JSONDecodeError, TypeError):
        return None, []
