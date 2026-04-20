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
    openai_realtime_model: str = os.getenv("OPENAI_REALTIME_MODEL", "")
    openai_text_model: str = os.getenv("OPENAI_TEXT_MODEL", "")

    # ElevenLabs: AI music generation for narration BGM (Music API)
    elevenlabs_api_key: str = os.getenv("ELEVENLABS_API_KEY", "")

    # Azure Speech / Speaker Recognition (Voice ID): key, region, and optional endpoint
    azure_speech_key: str = os.getenv("AZURE_SPEECH_KEY", "")
    azure_speech_region: str = os.getenv("AZURE_SPEECH_REGION", "")
    azure_speech_endpoint: str = os.getenv("AZURE_SPEECH_ENDPOINT", "")

    # Picovoice Eagle (Voice ID): default backend when key is set
    picovoice_access_key: str = os.getenv("PICOVOICE_ACCESS_KEY", "")
    voice_id_backend: str = os.getenv("VOICE_ID_BACKEND", "eagle")  # "eagle" | "azure"

settings = Settings()
