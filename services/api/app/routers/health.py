import logging
from pathlib import Path

from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()

# Baked in at Docker build (ARG BUILD_SHA); used to verify production runs the exact image we built
BUILD_SHA_PATH = Path("/app/.build_sha")


def _read_build_sha() -> str | None:
    try:
        if BUILD_SHA_PATH.exists():
            return BUILD_SHA_PATH.read_text().strip() or None
    except Exception:
        pass
    return None


@router.get("/health")
def health():
    logger.info("health: OK")
    out: dict = {"status": "ok"}
    build_sha = _read_build_sha()
    if build_sha:
        out["build_sha"] = build_sha
    return out
