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
