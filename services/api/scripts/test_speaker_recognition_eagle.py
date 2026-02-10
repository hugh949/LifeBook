#!/usr/bin/env python3
"""
Test Picovoice Eagle (Voice ID) access.

Keys are read from the repo root .env only. Run from anywhere using the full path to the script, e.g.:

  python /path/to/LifeBook/services/api/scripts/test_speaker_recognition_eagle.py

Exits 0 if Eagle is available and the profiler/recognizer pipeline runs; non-zero otherwise.
Enrollment may not reach 100% with silence; the script still passes if the library works.
"""
from __future__ import annotations

import os
import sys

_script_dir = os.path.dirname(os.path.abspath(__file__))
_api_root = os.path.abspath(os.path.join(_script_dir, ".."))
_repo_root = os.path.abspath(os.path.join(_script_dir, "..", "..", ".."))
if _api_root not in sys.path:
    sys.path.insert(0, _api_root)

# Load .env from repo root only (single source of truth)
try:
    from dotenv import load_dotenv
    load_dotenv(os.path.join(_repo_root, ".env"))
except ImportError:
    pass

# Import after path and env
from app.services import speaker_recognition_eagle


def make_minimal_wav_seconds(seconds: float) -> bytes:
    """Build a minimal valid WAV (16 kHz, 16-bit mono) of silence."""
    num_samples = int(16000 * seconds)
    data_len = num_samples * 2
    header = bytearray(44)
    header[0:4] = b"RIFF"
    header[4:8] = (36 + data_len).to_bytes(4, "little")
    header[8:12] = b"WAVE"
    header[12:16] = b"fmt "
    header[16:20] = (16).to_bytes(4, "little")
    header[20:22] = (1).to_bytes(2, "little")
    header[22:24] = (1).to_bytes(2, "little")
    header[24:28] = (16000).to_bytes(4, "little")
    header[28:32] = (32000).to_bytes(4, "little")
    header[32:34] = (2).to_bytes(2, "little")
    header[34:36] = (16).to_bytes(2, "little")
    header[36:40] = b"data"
    header[40:44] = data_len.to_bytes(4, "little")
    return bytes(header) + (b"\x00\x00" * num_samples)


def main() -> int:
    if not speaker_recognition_eagle.is_available():
        print("PICOVOICE_ACCESS_KEY not set. Set it in the repo root .env.", file=sys.stderr)
        return 2

    print("Testing Picovoice Eagle (Voice ID)...")
    print()

    wav = make_minimal_wav_seconds(15.0)
    pcm = speaker_recognition_eagle.wav_to_pcm(wav)
    if not pcm:
        print("WAV to PCM: FAILED")
        return 1
    print(f"WAV to PCM: OK ({len(pcm)} samples)")

    try:
        import pveagle
    except ImportError:
        print("pveagle not installed. Run: pip install pveagle", file=sys.stderr)
        return 1

    from app.core.config import settings
    key = (settings.picovoice_access_key or "").strip()

    try:
        profiler = pveagle.create_profiler(key)
    except Exception as e:
        print(f"Create profiler: FAILED — {e}")
        return 1
    print("Create profiler: OK")

    try:
        min_samples = profiler.min_enroll_samples
        percentage = 0.0
        idx = 0
        while idx < len(pcm) and percentage < 100.0:
            chunk = pcm[idx : idx + min_samples]
            if len(chunk) < min_samples:
                break
            percentage, feedback = profiler.enroll(chunk)
            idx += min_samples
    except Exception as e:
        print(f"Enroll: FAILED — {e}")
        try:
            profiler.delete()
        except Exception:
            pass
        return 1

    if percentage >= 100.0:
        print(f"Enroll: OK (100%)")
        try:
            profile = profiler.export()
            profiler.delete()
        except Exception as e:
            print(f"Export profile: FAILED — {e}")
            try:
                profiler.delete()
            except Exception:
                pass
            return 1
        profile_bytes = profile.to_bytes()
        print("Export profile: OK")

        # Recognizer: process same audio
        recognizer = pveagle.create_recognizer(key, [profile])
        frame_len = recognizer.frame_length
        scores: list[float] = []
        for i in range(0, len(pcm) - frame_len, frame_len):
            frame = pcm[i : i + frame_len]
            if len(frame) != frame_len:
                break
            frame_scores = recognizer.process(frame)
            if frame_scores:
                scores.append(float(frame_scores[0]))
        recognizer.delete()
        mean_score = sum(scores) / len(scores) if scores else 0.0
        print(f"Recognizer (same audio): OK (mean score={mean_score:.3f})")
    else:
        try:
            profiler.delete()
        except Exception:
            pass
        print(f"Enroll: OK ({percentage:.0f}% — need more speech for 100%; Eagle library works)")

    print()
    print("Eagle (Voice ID) is working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
