from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.routers import health, media, realtime, sessions, moments

app = FastAPI(title="LifeBook API", version="0.1.0")
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
