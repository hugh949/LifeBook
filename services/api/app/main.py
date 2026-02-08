import logging
import traceback
import time
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.core.logging_config import setup_logging
from app.routers import health, media, realtime, sessions, moments

setup_logging()
logger = logging.getLogger("lifebook.api")

app = FastAPI(title="LifeBook API", version="0.1.0")


@app.on_event("startup")
def startup_log_config():
    """Log config status at startup (no secrets). Helps troubleshoot env var issues."""
    logger.info("LifeBook API starting up (if you see this in Log Stream, logging is working)")
    cfg = {
        "APP_ENV": settings.app_env,
        "DATABASE_URL_set": bool(settings.database_url),
        "AZURE_STORAGE_ACCOUNT": settings.azure_storage_account or "(empty)",
        "AZURE_STORAGE_ACCOUNT_KEY_set": bool(settings.azure_storage_account_key),
        "OPENAI_API_KEY_set": bool((settings.openai_api_key or "").strip()),
        "CORS_ALLOW_ORIGINS": settings.cors_allow_origins[:80] + ("..." if len(settings.cors_allow_origins) > 80 else ""),
        "photos_container": settings.photos_container,
        "audio_container": settings.audio_container,
    }
    logger.info("LifeBook API startup config: %s", cfg)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every request and response for troubleshooting."""
    rid = f"{id(request):x}"
    path = request.url.path
    method = request.method
    start = time.perf_counter()
    logger.info("[%s] -> %s %s", rid, method, path)
    try:
        response = await call_next(request)
        elapsed_ms = (time.perf_counter() - start) * 1000
        status = response.status_code
        level = logging.WARNING if status >= 400 else logging.INFO
        logger.log(level, "[%s] <- %s %s %d %.0fms", rid, method, path, status, elapsed_ms)
        return response
    except Exception as e:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.exception("[%s] ERROR %s %s after %.0fms: %s", rid, method, path, elapsed_ms, e)
        raise


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch unhandled exceptions, log full traceback, return 500."""
    logger.exception(
        "Unhandled exception %s %s: %s\n%s",
        request.method,
        request.url.path,
        exc,
        traceback.format_exc(),
    )
    return JSONResponse(
        status_code=500,
        content={
            "detail": str(exc),
            "type": type(exc).__name__,
            "_traceback": traceback.format_exc() if settings.app_env != "production" else None,
        },
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_allow_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(media.router)
app.include_router(realtime.router)
app.include_router(sessions.router)
app.include_router(moments.router)
