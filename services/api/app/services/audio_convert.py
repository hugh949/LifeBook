"""
Convert uploaded audio to WAV 16 kHz 16-bit mono for Azure Speaker Recognition.
Accepts webm, wav, or other formats supported by pydub/ffmpeg.
"""
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


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
