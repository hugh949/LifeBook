"""AI-generated background music for narration (ElevenLabs Music API)."""
import logging

import httpx

logger = logging.getLogger(__name__)

ELEVENLABS_MUSIC_URL = "https://api.elevenlabs.io/v1/music"
DEFAULT_DURATION_SEC = 60  # frontend loops if narration is longer
HTTP_TIMEOUT = 120.0  # music generation can take 30-90s


def generate_bgm_audio(prompt: str, duration: int = DEFAULT_DURATION_SEC, api_key: str = "") -> bytes | None:
    """
    Generate instrumental BGM via ElevenLabs Music API. Returns audio bytes (MP3) or None on failure.
    """
    prompt = (prompt or "").strip()
    if not prompt:
        return None
    key = (api_key or "").strip()
    if not key:
        logger.warning("music_generation: ELEVENLABS_API_KEY not set")
        return None

    # music_length_ms: 3000–600000 (3s–10min); use duration in ms
    length_ms = min(max(5000, duration * 1000), 120000)  # 5s–120s for BGM
    payload = {
        "prompt": prompt[:4100],
        "music_length_ms": length_ms,
        "force_instrumental": True,
        "model_id": "music_v1",
    }
    try:
        with httpx.Client(timeout=HTTP_TIMEOUT) as client:
            r = client.post(
                ELEVENLABS_MUSIC_URL,
                params={"output_format": "mp3_22050_32"},
                headers={
                    "Content-Type": "application/json",
                    "xi-api-key": key,
                },
                json=payload,
            )
            r.raise_for_status()
            return r.content
    except httpx.HTTPStatusError as e:
        logger.warning("music_generation: ElevenLabs HTTP %s: %s", e.response.status_code, (e.response.text or "")[:300])
        return None
    except Exception as e:
        logger.warning("music_generation: generate_bgm_audio failed: %s", e)
        return None
