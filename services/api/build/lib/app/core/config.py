import os
from pydantic import BaseModel

# Default family ID for local MVP when no auth (see migration 001).
DEFAULT_FAMILY_ID = "00000000-0000-4000-a000-000000000001"


class Settings(BaseModel):
    app_env: str = os.getenv("APP_ENV", "local")
    database_url: str = os.getenv("DATABASE_URL", "")
    cors_allow_origins: str = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000")

    azure_storage_account: str = os.getenv("AZURE_STORAGE_ACCOUNT", "")
    azure_storage_account_key: str = os.getenv("AZURE_STORAGE_ACCOUNT_KEY", "")
    photos_container: str = os.getenv("AZURE_STORAGE_CONTAINER_PHOTOS", "photos")
    audio_container: str = os.getenv("AZURE_STORAGE_CONTAINER_AUDIO", "audio")
    sas_ttl_minutes: int = int(os.getenv("AZURE_STORAGE_SAS_TTL_MINUTES", "15"))
    read_sas_ttl_minutes: int = int(os.getenv("AZURE_STORAGE_READ_SAS_TTL_MINUTES", "60"))

    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_realtime_model: str = os.getenv("OPENAI_REALTIME_MODEL", "")
    openai_text_model: str = os.getenv("OPENAI_TEXT_MODEL", "")

settings = Settings()
