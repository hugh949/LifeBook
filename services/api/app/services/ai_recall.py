"""AI-derived recall label: summary and topic tags from participant text (OpenAI). Multilingual-friendly."""
import json
import re

from app.core.openai_models import (
    content_manager_model,
    curator_model,
    storyteller_model,
)
from app.services.openai_chat import chat_text

SYSTEM_PROMPT = """You are a helper that creates short labels for voice conversation recall.
Given only what the person (the user) said in a conversation, output:
1. A one-line summary (max 15 words) of what they talked about or wanted. Use the same language as the input. No filler like "The user said...".
2. Four to six topic tags: nouns or key themes (e.g. wedding, medication, holiday). No greetings, fillers, or generic words (no "thanks", "yeah", "little", "kind"). Use the same language as the input.
Output valid JSON only, no markdown: {"summary": "...", "tags": ["tag1", "tag2", ...]}"""


def generate_recall_label(participant_text: str, api_key: str, model: str = "") -> tuple[str | None, list[str]]:
    """
    Call OpenAI to produce a one-line summary and topic tags from participant-only text.
    Returns (summary, tags). On failure or empty input, returns (None, []).
    Multilingual: model uses same language as input.
    Uses Content Manager (Agent 4) model by default — light inventory labeling.
    """
    text = (participant_text or "").strip()
    if not text or not api_key:
        return None, []

    content = chat_text(
        api_key=api_key,
        model=content_manager_model(model),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": text[:8000]},
        ],
        max_completion_tokens=400,
        temperature=0.3,
        reasoning_effort="none",
        log_label="ai_recall.generate_recall_label",
    )
    if not content:
        return None, []
    return _parse_response(content)


STORY_TITLE_PROMPT = """You are a helper that creates a short, descriptive title for a family story.
Given the story text (from a voice conversation or narrative), output a single line: a title of 4 to 10 words that captures the main theme or subject. Use the same language as the input. No quotes, no "Title:", no filler.
Output only the title line, nothing else."""


def generate_story_title(story_content: str, api_key: str, model: str = "") -> str | None:
    """
    Call OpenAI to produce a short title (4–10 words) from story content.
    Returns the title string or None on failure/empty input.
    Uses Storyteller (Agent 2) model by default.
    """
    text = (story_content or "").strip()
    if not text or not api_key:
        return None
    title = chat_text(
        api_key=api_key,
        model=storyteller_model(model),
        messages=[
            {"role": "system", "content": STORY_TITLE_PROMPT},
            {"role": "user", "content": text[:6000]},
        ],
        max_completion_tokens=200,
        temperature=0.3,
        reasoning_effort="none",
        log_label="ai_recall.generate_story_title",
    )
    if not title:
        return None
    title = title.strip().strip('"').strip()
    return title if title else None


NARRATE_MUSIC_PROMPT_SYSTEM = """You write a short prompt for an AI music generator. The music is a soft looping bed under a spoken personal/family story (voiceover).

From the story title/body/summary, infer:
1) Place / region — where it likely happened (city, countryside, country, cultural region). If unclear, use a gentle universal bed.
2) Era / decade — when it likely happened (e.g. 1950s, 1970s, early 2000s, wartime). Use dates, ages, tech, clothing, or cultural cues; if unclear, prefer timeless acoustic warmth.
3) Language / cultural feel — instruments and textures that fit that place and era (period-appropriate, not parody).
4) Emotional tone — nostalgic, tender, warm, reflective, etc.

Write 1–3 sentences describing the ideal instrumental bed:
- Name place + era when you can infer them (e.g. "rural Punjab, late 1970s" or "coastal California, mid-1990s").
- Specify period instruments / textures and a slow-to-moderate tempo (about 50–70 bpm).
- Keep volume and arrangement sparse so speech stays clear — gentle, not cinematic or overpowering.
- MUST include: "instrumental only", "no vocals", and "suitable for voiceover" (or "suitable for narration").
- No famous song titles, lyrics, or artist names.
Keep the whole prompt under ~280 characters when possible."""


def generate_narrate_music_prompt(
    story_text: str,
    api_key: str,
    model: str = "",
    *,
    title: str = "",
    summary: str = "",
) -> str:
    """
    Produce a music-generation prompt from the story for synthetic BGM.
    Steers toward era- and place-appropriate instrumental beds when cues exist.
    On failure or empty input, returns a safe default prompt.
    Uses Curator (Agent 3) model by default.
    """
    body = (story_text or "").strip()
    title_s = (title or "").strip()
    summary_s = (summary or "").strip()
    default_prompt = (
        "Soft ambient piano, gentle timeless warmth, 60 bpm, "
        "instrumental only, no vocals, suitable for voiceover."
    )
    if not api_key or not (body or title_s or summary_s):
        return default_prompt

    parts: list[str] = []
    if title_s:
        parts.append(f"Title: {title_s}")
    if summary_s:
        parts.append(f"Summary: {summary_s[:800]}")
    if body:
        parts.append(f"Story:\n{body[:3500]}")
    user_blob = "\n\n".join(parts)

    content = chat_text(
        api_key=api_key,
        model=curator_model(model),
        messages=[
            {"role": "system", "content": NARRATE_MUSIC_PROMPT_SYSTEM},
            {"role": "user", "content": user_blob[:4200]},
        ],
        max_completion_tokens=300,
        temperature=0.35,
        reasoning_effort="none",
        log_label="ai_recall.generate_narrate_music_prompt",
    )
    if not content:
        return default_prompt
    prompt = content.strip().strip('"').strip()
    if not prompt or len(prompt) > 600:
        return default_prompt
    low = prompt.lower()
    if "instrumental" not in low and "no vocals" not in low:
        prompt = prompt.rstrip(".") + ". Instrumental only, no vocals, suitable for voiceover."
    return prompt


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


def generate_narrate_mood(story_text: str, api_key: str, model: str = "") -> tuple[str, str]:
    """
    AI-driven: review the full narration and pick the best background music track.
    Returns (track_id, music_brief). track_id is one of the registry ids (e.g. reflective, warm).
    On failure or empty input, returns ("neutral", "").
    Uses Curator (Agent 3) model by default.
    """
    text = (story_text or "").strip()
    if not text or not api_key:
        return "neutral", ""
    content = chat_text(
        api_key=api_key,
        model=curator_model(model),
        messages=[
            {"role": "system", "content": NARRATE_MUSIC_SELECTION_PROMPT},
            {"role": "user", "content": text[:6000]},
        ],
        max_completion_tokens=300,
        temperature=0.2,
        reasoning_effort="none",
        log_label="ai_recall.generate_narrate_mood",
    )
    if not content:
        return "neutral", ""
    track_id, music_brief = _parse_narrate_music_response(content)
    return track_id, music_brief


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
