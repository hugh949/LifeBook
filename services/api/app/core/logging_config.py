"""Centralized logging config for LifeBook API. Logs go to stderr and appear in Azure Log Stream."""
import logging
import os
import sys
from datetime import datetime, timezone

# ISO8601 format for Azure Log Analytics
LOG_FORMAT = "%(asctime)s.%(msecs)03dZ [%(levelname)s] %(name)s: %(message)s"
DATE_FMT = "%Y-%m-%dT%H:%M:%S"


class UTCTimeFormatter(logging.Formatter):
    """Use UTC for log timestamps."""

    def formatTime(self, record, datefmt=None):
        ct = datetime.fromtimestamp(record.created, tz=timezone.utc)
        if datefmt:
            s = ct.strftime(datefmt)
        else:
            s = ct.strftime(self.default_time_format)
        return s


def setup_logging(level: str | None = None) -> None:
    """Configure root logger for API. Call once at startup. Set LOG_LEVEL env var for DEBUG/INFO."""
    level = level or os.getenv("LOG_LEVEL", "INFO")
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    if not root.handlers:
        h = logging.StreamHandler(sys.stderr)
        h.setFormatter(UTCTimeFormatter(LOG_FORMAT, datefmt=DATE_FMT))
        root.addHandler(h)
    # Reduce noisy lib logs
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("httpcore").setLevel(logging.WARNING)
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)  # we log requests ourselves
