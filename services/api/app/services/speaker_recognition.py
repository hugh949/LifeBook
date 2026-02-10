"""
Azure Speaker Recognition (Voice ID): create profile, enroll, identify.
Uses REST API 2021-09-05. Audio: WAV, 16 kHz, 16-bit mono PCM.
"""
import logging
from typing import Any

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

API_VERSION = "2021-09-05"
BASE_PATH = "speaker-recognition/identification/text-independent"


def _base_url() -> str:
    endpoint = (settings.azure_speech_endpoint or "").strip()
    if endpoint:
        return endpoint.rstrip("/")
    region = (settings.azure_speech_region or "").strip()
    if not region:
        return ""
    return f"https://{region}.api.cognitive.microsoft.com"


def _headers() -> dict[str, str]:
    key = (settings.azure_speech_key or "").strip()
    if not key:
        return {}
    return {"Ocp-Apim-Subscription-Key": key}


def is_available() -> bool:
    return bool(_base_url() and _headers())


def create_profile() -> str | None:
    """
    Create an empty speaker profile for identification. Returns profile_id (UUID string) or None.
    """
    url = f"{_base_url()}/{BASE_PATH}/profiles?api-version={API_VERSION}"
    headers = _headers()
    if not headers:
        return None
    try:
        with httpx.Client() as client:
            r = client.post(
                url,
                headers={**headers, "Content-Type": "application/json"},
                json={"locale": "en-us"},
                timeout=10.0,
            )
        if r.status_code == 201:
            data = r.json()
            pid = data.get("profileId") or data.get("profile_id")
            if pid:
                logger.info("speaker_recognition: created profile %s", pid)
                return str(pid)
        logger.warning("speaker_recognition: create_profile %s %s", r.status_code, r.text[:200])
        return None
    except Exception as e:
        logger.exception("speaker_recognition: create_profile error: %s", e)
        return None


def create_enrollment(profile_id: str, audio_bytes: bytes) -> dict[str, Any] | None:
    """
    Add enrollment audio to a profile. Audio must be WAV 16 kHz 16-bit mono.
    Returns enrollment info dict (enrollmentStatus, remainingEnrollmentsSpeechLengthInSec, etc.) or None.
    """
    url = f"{_base_url()}/{BASE_PATH}/profiles/{profile_id}/enrollments?api-version={API_VERSION}"
    headers = _headers()
    if not headers:
        return None
    headers["Content-Type"] = "audio/wav; codecs=audio/pcm"
    try:
        with httpx.Client() as client:
            r = client.post(url, headers=headers, content=audio_bytes, timeout=30.0)
        if r.status_code == 201:
            data = r.json()
            logger.info(
                "speaker_recognition: enrollment profile=%s status=%s remaining_sec=%s",
                profile_id,
                data.get("enrollmentStatus"),
                data.get("remainingEnrollmentsSpeechLengthInSec"),
            )
            return data
        logger.warning("speaker_recognition: create_enrollment %s %s", r.status_code, r.text[:200])
        return None
    except Exception as e:
        logger.exception("speaker_recognition: create_enrollment error: %s", e)
        return None


def identify_single_speaker(profile_ids: list[str], audio_bytes: bytes) -> str | None:
    """
    Identify which of the given profiles matches the speaker in the audio.
    Audio must be WAV 16 kHz 16-bit mono; at least ~4 s of speech recommended (or use ignoreMinLength).
    Returns the matched profile_id, or None if no match / error.
    """
    if not profile_ids:
        return None
    ids_param = ",".join(profile_ids)
    url = f"{_base_url()}/{BASE_PATH}/profiles:identifySingleSpeaker?api-version={API_VERSION}&profileIds={ids_param}&ignoreMinLength=true"
    headers = _headers()
    if not headers:
        return None
    headers["Content-Type"] = "audio/wav; codecs=audio/pcm"
    try:
        with httpx.Client() as client:
            r = client.post(url, headers=headers, content=audio_bytes, timeout=15.0)
        if r.status_code != 200:
            logger.warning("speaker_recognition: identify %s %s", r.status_code, r.text[:200])
            return None
        data = r.json()
        identified = data.get("identifiedProfile") or {}
        pid = identified.get("profileId")
        score = identified.get("score", 0)
        score_f = float(score) if score is not None else 0.0
        logger.info(
            "speaker_recognition: identify response profile=%s score=%s (threshold 0.45)",
            pid, score_f,
        )
        if pid and score_f >= 0.45:
            return str(pid)
        return None
    except Exception as e:
        logger.exception("speaker_recognition: identify error: %s", e)
        return None
