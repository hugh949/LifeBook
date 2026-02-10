"""
Picovoice Eagle Voice ID: enroll and identify speakers.
Uses pveagle; audio must be 16 kHz 16-bit mono PCM (WAV body after 44-byte header).
"""
import logging
import struct
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)

# Minimum WAV data length (after 44-byte header) to attempt parse
WAV_HEADER_LEN = 44
IDENTIFY_SCORE_THRESHOLD = 0.5


def _access_key() -> str:
    return (settings.picovoice_access_key or "").strip()


def is_available() -> bool:
    return bool(_access_key())


def wav_to_pcm(wav_bytes: bytes) -> list[int] | None:
    """
    Extract 16-bit LE mono PCM from WAV bytes (44-byte header + data).
    Returns list of int16 samples or None if invalid.
    """
    if len(wav_bytes) < WAV_HEADER_LEN + 2:
        return None
    if wav_bytes[:4] != b"RIFF" or wav_bytes[8:12] != b"WAVE":
        return None
    data = wav_bytes[WAV_HEADER_LEN:]
    if len(data) % 2 != 0:
        data = data[: len(data) - 1]
    count = len(data) // 2
    try:
        return [struct.unpack_from("<h", data, i * 2)[0] for i in range(count)]
    except struct.error:
        return None


def enroll_participant(participant: Any, wav_bytes: bytes, db: Any) -> dict[str, Any]:
    """
    Append WAV PCM to participant's pending buffer; run Eagle profiler.
    If enrollment reaches 100%, save profile and clear pending; else keep pending.
    Updates participant in DB; caller should commit.
    Returns dict: ok, message, remaining_speech_sec (optional).
    """
    key = _access_key()
    if not key:
        return {"ok": False, "message": "Voice ID not configured"}
    pcm = wav_to_pcm(wav_bytes)
    if not pcm:
        return {"ok": False, "message": "Invalid or unsupported WAV"}
    try:
        import pveagle
    except ImportError:
        logger.warning("speaker_recognition_eagle: pveagle not installed")
        return {"ok": False, "message": "Speaker recognition not available"}

    # Append to pending PCM
    pending = getattr(participant, "eagle_pending_pcm", None) or b""
    # Pending is stored as bytes: 16-bit LE per sample
    pcm_bytes = struct.pack(f"<{len(pcm)}h", *pcm)
    new_pending = pending + pcm_bytes
    participant.eagle_pending_pcm = new_pending
    db.flush()

    # Run profiler on full pending
    pcm_from_pending: list[int] = []
    for i in range(0, len(new_pending), 2):
        if i + 2 <= len(new_pending):
            pcm_from_pending.append(struct.unpack_from("<h", new_pending, i)[0])
    if not pcm_from_pending:
        return {"ok": True, "message": "Enrolling (add more speech)", "remaining_speech_sec": 10.0}

    try:
        profiler = pveagle.create_profiler(key)
        try:
            min_samples = profiler.min_enroll_samples
            percentage = 0.0
            idx = 0
            while idx < len(pcm_from_pending) and percentage < 100.0:
                chunk = pcm_from_pending[idx : idx + min_samples]
                if len(chunk) < min_samples:
                    break
                percentage, feedback = profiler.enroll(chunk)
                idx += min_samples
            if percentage >= 100.0:
                profile = profiler.export()
                participant.eagle_profile_data = profile.to_bytes()
                participant.eagle_pending_pcm = None
                participant.enrollment_status = "Enrolled"
                db.flush()
                return {"ok": True, "message": "Enrolled", "remaining_speech_sec": None}
            # Not enough yet
            participant.enrollment_status = "Enrolling"
            db.flush()
            remaining = max(0, 15 - (len(pcm_from_pending) / 16000))  # rough sec remaining at 16 kHz
            return {"ok": True, "message": "Enrolling (add more speech for best recognition)", "remaining_speech_sec": remaining}
        finally:
            profiler.delete()
    except Exception as e:
        logger.exception("speaker_recognition_eagle: enroll error %s", e)
        return {"ok": False, "message": "Enrollment failed"}


def identify_single_speaker(
    participants_with_profiles: list[tuple[str, bytes]],
    wav_bytes: bytes,
) -> str | None:
    """
    Identify which of the given participants (id, profile_bytes) matches the WAV.
    Returns participant_id of best match if score >= threshold, else None.
    """
    if not participants_with_profiles:
        return None
    key = _access_key()
    if not key:
        return None
    pcm = wav_to_pcm(wav_bytes)
    if not pcm or len(pcm) < 1000:
        return None
    try:
        import pveagle
    except ImportError:
        return None
    try:
        profiles = []
        for _pid, blob in participants_with_profiles:
            try:
                profiles.append(pveagle.EagleProfile.from_bytes(blob))
            except Exception:
                continue
        if not profiles:
            return None
        recognizer = pveagle.create_recognizer(key, profiles)
        try:
            frame_len = recognizer.frame_length
            scores_per_speaker: list[list[float]] = [[] for _ in profiles]
            for i in range(0, len(pcm) - frame_len, frame_len):
                frame = pcm[i : i + frame_len]
                if len(frame) != frame_len:
                    break
                frame_scores = recognizer.process(frame)
                for j, s in enumerate(frame_scores):
                    if j < len(scores_per_speaker):
                        scores_per_speaker[j].append(s)
            recognizer.delete()
        except Exception:
            try:
                recognizer.delete()
            except Exception:
                pass
            return None
        # Mean score per speaker
        mean_scores = []
        for lst in scores_per_speaker:
            mean_scores.append(sum(lst) / len(lst) if lst else 0.0)
        best_idx = max(range(len(mean_scores)), key=lambda i: mean_scores[i])
        if mean_scores[best_idx] >= IDENTIFY_SCORE_THRESHOLD:
            logger.info(
                "speaker_recognition_eagle: identify best participant_idx=%s score=%.3f",
                best_idx,
                mean_scores[best_idx],
            )
            return participants_with_profiles[best_idx][0]
        return None
    except Exception as e:
        logger.exception("speaker_recognition_eagle: identify error %s", e)
        return None
