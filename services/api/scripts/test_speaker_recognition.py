#!/usr/bin/env python3
"""
Test Voice ID (Speaker Recognition) access — Azure or Picovoice Eagle.

Keys are read from the repo root .env only. Run from anywhere using the full path to the script, e.g.:

  python /path/to/LifeBook/services/api/scripts/test_speaker_recognition.py

Exits 0 if the configured backend is working; non-zero otherwise.
"""
from __future__ import annotations

import os
import sys

# Load .env from repo root only (single source of truth)
try:
    from dotenv import load_dotenv
    _script_dir = os.path.dirname(os.path.abspath(__file__))
    _repo_root = os.path.abspath(os.path.join(_script_dir, "..", "..", ".."))
    load_dotenv(os.path.join(_repo_root, ".env"))
except ImportError:
    pass

import httpx

API_VERSION = "2021-09-05"
BASE_PATH = "speaker-recognition/identification/text-independent"


def get_config() -> tuple[str, str, str | None]:
    key = (os.getenv("AZURE_SPEECH_KEY") or "").strip()
    region = (os.getenv("AZURE_SPEECH_REGION") or "").strip()
    endpoint = (os.getenv("AZURE_SPEECH_ENDPOINT") or "").strip() or None
    return key, region, endpoint


def make_minimal_wav_seconds(seconds: float) -> bytes:
    """Build a minimal valid WAV (16 kHz, 16-bit mono) of silence."""
    num_samples = int(16000 * seconds)
    data_len = num_samples * 2
    header = bytearray(44)
    # RIFF
    header[0:4] = b"RIFF"
    header[4:8] = (36 + data_len).to_bytes(4, "little")
    header[8:12] = b"WAVE"
    # fmt
    header[12:16] = b"fmt "
    header[16:20] = (16).to_bytes(4, "little")
    header[20:22] = (1).to_bytes(2, "little")  # PCM
    header[22:24] = (1).to_bytes(2, "little")  # mono
    header[24:28] = (16000).to_bytes(4, "little")
    header[28:32] = (32000).to_bytes(4, "little")
    header[32:34] = (2).to_bytes(2, "little")
    header[34:36] = (16).to_bytes(2, "little")
    # data
    header[36:40] = b"data"
    header[40:44] = data_len.to_bytes(4, "little")
    return bytes(header) + (b"\x00\x00" * num_samples)


def _base_url(region: str, endpoint: str | None) -> str:
    if endpoint:
        return endpoint.rstrip("/")
    if region:
        return f"https://{region}.api.cognitive.microsoft.com"
    return ""


def test_create_profile(key: str, region: str, endpoint: str | None) -> tuple[bool, str, int, str | None]:
    """Try to create a speaker profile. Returns (ok, message, status_code, profile_id)."""
    base = _base_url(region, endpoint)
    if not base:
        return False, "No AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_REGION", -1, None
    url = f"{base}/{BASE_PATH}/profiles?api-version={API_VERSION}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client() as client:
            r = client.post(url, headers=headers, json={"locale": "en-us"}, timeout=15.0)
    except Exception as e:
        return False, f"Request failed: {e}", -1, None
    if r.status_code == 201:
        data = r.json()
        pid = data.get("profileId") or data.get("profile_id", "")
        return True, f"Profile created: {pid}", r.status_code, str(pid) if pid else None
    return False, f"{r.status_code} {r.text[:500]}", r.status_code, None


def test_enrollment(key: str, region: str, endpoint: str | None, profile_id: str) -> tuple[bool, str, int]:
    """Try to add enrollment audio (minimal WAV). Returns (ok, message, status_code)."""
    base = _base_url(region, endpoint)
    if not base:
        return False, "No AZURE_SPEECH_ENDPOINT or AZURE_SPEECH_REGION", -1
    url = f"{base}/{BASE_PATH}/profiles/{profile_id}/enrollments?api-version={API_VERSION}"
    headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "audio/wav; codecs=audio/pcm",
    }
    # At least a few seconds of audio for enrollment (silence is valid)
    wav = make_minimal_wav_seconds(5.0)
    try:
        with httpx.Client() as client:
            r = client.post(url, headers=headers, content=wav, timeout=30.0)
    except Exception as e:
        return False, f"Request failed: {e}", -1
    if r.status_code == 201:
        data = r.json()
        status = data.get("enrollmentStatus", "")
        return True, f"Enrollment accepted, status={status}", r.status_code
    return False, f"{r.status_code} {r.text[:500]}", r.status_code


def main() -> int:
    backend = (os.getenv("VOICE_ID_BACKEND") or "eagle").strip().lower()
    picovoice_key = (os.getenv("PICOVOICE_ACCESS_KEY") or "").strip()
    key, region, endpoint = get_config()

    # When Eagle is the backend and key is set, run Eagle test script
    if backend == "eagle":
        if not picovoice_key:
            print("VOICE_ID_BACKEND=eagle but PICOVOICE_ACCESS_KEY not set. Set it in the repo root .env.", file=sys.stderr)
            return 2
        script_dir = os.path.dirname(os.path.abspath(__file__))
        eagle_script = os.path.join(script_dir, "test_speaker_recognition_eagle.py")
        if os.path.isfile(eagle_script):
            import subprocess
            result = subprocess.run([sys.executable, eagle_script], env=os.environ)
            return result.returncode
        print("Eagle script not found; run: python scripts/test_speaker_recognition_eagle.py", file=sys.stderr)
        return 2

    # Azure path
    if not key:
        print("Missing AZURE_SPEECH_KEY. Set it in the repo root .env.", file=sys.stderr)
        return 2
    if not region and not endpoint:
        print("Missing AZURE_SPEECH_REGION or AZURE_SPEECH_ENDPOINT. Set one in the repo root .env.", file=sys.stderr)
        return 2

    print("Testing Azure Speaker Recognition...")
    print(f"  Region: {region or '(from endpoint)'}")
    if endpoint:
        print(f"  Endpoint: {endpoint}")
    print()

    ok, msg, status, profile_id = test_create_profile(key, region, endpoint)
    if not ok:
        print("Create profile: FAILED")
        print(f"  {msg}")
        if status == 401:
            print()
            print("  401 usually means Speaker Recognition is not enabled for this subscription.")
            print("  See: https://aka.ms/azure-speaker-recognition")
        return 1
    print("Create profile: OK")
    print(f"  {msg}")
    print()

    if profile_id:
        ok2, msg2, status2 = test_enrollment(key, region, endpoint, profile_id)
        if not ok2:
            print("Enrollment: FAILED")
            print(f"  {msg2}")
            return 1
        print("Enrollment: OK")
        print(f"  {msg2}")
    else:
        print("Enrollment: skipped (no profile id)")

    print()
    print("Speaker Recognition is working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
