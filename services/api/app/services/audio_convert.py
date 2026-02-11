"""
Convert uploaded audio to WAV 16 kHz 16-bit mono for Azure Speaker Recognition.
Accepts webm, wav, or other formats supported by pydub/ffmpeg.

Also provides LUFS normalization for narration (TTS) and BGM using ffmpeg loudnorm.
"""
import io
import logging
import subprocess
from typing import Optional

logger = logging.getLogger(__name__)

# LUFS targets: narration (voice) louder so it sits above BGM
NARRATION_LUFS = -16
BGM_LUFS = -24
FFMPEG_LOUDNORM_TIMEOUT = 60


def normalize_lufs_mp3(audio_bytes: bytes, target_lufs: float) -> Optional[bytes]:
    """
    Normalize MP3 audio to target integrated loudness (LUFS) using ffmpeg loudnorm.
    Returns normalized MP3 bytes, or None on failure (or if ffmpeg not available).
    """
    if not audio_bytes or len(audio_bytes) < 100:
        return None
    # Clamp to valid loudnorm range
    i = max(-70.0, min(-5.0, target_lufs))
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-i",
                "pipe:0",
                "-af",
                f"loudnorm=I={i}:TP=-1.5:LRA=11",
                "-ar",
                "44100",
                "-f",
                "mp3",
                "pipe:1",
            ],
            input=audio_bytes,
            capture_output=True,
            timeout=FFMPEG_LOUDNORM_TIMEOUT,
        )
        if proc.returncode != 0 or not proc.stdout:
            logger.warning(
                "audio_convert: loudnorm failed returncode=%s stderr=%s",
                proc.returncode,
                (proc.stderr or b"")[:500].decode("utf-8", errors="replace"),
            )
            return None
        return proc.stdout
    except FileNotFoundError:
        logger.debug("audio_convert: ffmpeg not found, skipping LUFS normalization")
        return None
    except subprocess.TimeoutExpired:
        logger.warning("audio_convert: loudnorm timed out")
        return None
    except Exception as e:
        logger.warning("audio_convert: normalize_lufs_mp3 failed: %s", e)
        return None


def to_wav_16k_mono(data: bytes, content_type: Optional[str] = None) -> Optional[bytes]:
    """
    Convert audio bytes to WAV 16 kHz 16-bit mono. Returns None if conversion fails.
    """
    try:
        from pydub import AudioSegment
    except ImportError:
        logger.debug("pydub not installed; cannot convert audio")
        return None
    if not data or len(data) < 100:
        return None
    try:
        fmt = None
        if content_type:
            if "webm" in content_type:
                fmt = "webm"
            elif "wav" in content_type or "wave" in content_type:
                fmt = "wav"
            elif "ogg" in content_type:
                fmt = "ogg"
            elif "mp3" in content_type or "mpeg" in content_type:
                fmt = "mp3"
        seg = AudioSegment.from_file(io.BytesIO(data), format=fmt)
        seg = seg.set_channels(1)
        seg = seg.set_frame_rate(16000)
        out = io.BytesIO()
        seg.export(out, format="wav", parameters=["-acodec", "pcm_s16le"])
        return out.getvalue()
    except Exception as e:
        logger.warning("audio_convert: %s", e)
        return None
