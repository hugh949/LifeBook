import os
from pydantic import BaseModel


class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "local")
    database_url: str = os.getenv("DATABASE_URL", "")
    cors_allow_origins: str = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000")

    # Session JWT secret for cookie auth. Must be set in any non-local environment.
    session_secret: str = os.getenv("SESSION_SECRET", "dev-lifebook-secret-change-me")
    session_cookie_name: str = os.getenv("SESSION_COOKIE_NAME", "lb_session")
    session_ttl_days: int = int(os.getenv("SESSION_TTL_DAYS", "30"))

    azure_storage_account: str = os.getenv("AZURE_STORAGE_ACCOUNT", "")
    azure_storage_account_key: str = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "")
    photos_container: str = os.getenv("AZURE_STORAGE_CONTAINER_PHOTOS", "photos")
    audio_container: str = os.getenv("AZURE_STORAGE_CONTAINER_AUDIO", "audio")
    sas_ttl_minutes: int = int(os.getenv("AZURE_STORAGE_SAS_TTL_MINUTES", "15"))
    read_sas_ttl_minutes: int = int(os.getenv("AZURE_STORAGE_READ_SAS_TTL_MINUTES", "60"))

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    # Per-agent models — see app.core.openai_models. Empty → role default
    # (OPENAI_TEXT_MODEL is a shared fallback for text roles when role-specific is unset).
    openai_realtime_model: str = os.getenv("OPENAI_REALTIME_MODEL", "")
    openai_text_model: str = os.getenv("OPENAI_TEXT_MODEL", "")
    openai_storyteller_model: str = os.getenv("OPENAI_STORYTELLER_MODEL", "")
    openai_curator_model: str = os.getenv("OPENAI_CURATOR_MODEL", "")
    openai_curator_tts_model: str = os.getenv("OPENAI_CURATOR_TTS_MODEL", "") or os.getenv(
        "OPENAI_TTS_MODEL", ""
    )
    openai_content_manager_model: str = os.getenv("OPENAI_CONTENT_MANAGER_MODEL", "")
    openai_chief_of_staff_model: str = os.getenv("OPENAI_CHIEF_OF_STAFF_MODEL", "")

    # ElevenLabs: AI music generation for narration BGM (Music API)
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")

    # Azure Speech / Speaker Recognition (Voice ID): key, region, and optional endpoint
    azure_speech_key: str = os.getenv("AZURE_SPEECH_KEY", "")
    azure_speech_region: str = os.getenv("AZURE_SPEECH_REGION", "")
    azure_speech_endpoint: str = os.getenv("AZURE_SPEECH_ENDPOINT", "")

    # Picovoice Eagle (Voice ID): default backend when key is set
    picovoice_access_key: str = os.getenv("PICOVOICE_ACCESS_KEY", "")
    voice_id_backend: str = os.getenv("VOICE_ID_BACKEND", "eagle")  # "eagle" | "azure"

    # Public web origin for password-reset links (e.g. http://localhost:3000)
    public_app_url: str = os.getenv("PUBLIC_APP_URL", "http://localhost:3000")

    # Optional SMTP for password-reset emails (if unset, local/dev returns a reset link in JSON)
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "")
    smtp_use_tls: bool = os.getenv("SMTP_USE_TLS", "true").lower() in ("1", "true", "yes")

settings = Settings()
