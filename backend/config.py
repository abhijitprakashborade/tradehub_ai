from pydantic_settings import BaseSettings
from pydantic import field_validator
from functools import lru_cache
from pathlib import Path
import logging
import os

BASE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    # App
    APP_NAME: str = "TradeHub AI"
    APP_VERSION: str = "1.1.0"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"

    # Database — resolved relative to backend dir so any cwd works
    DATABASE_URL: str = f"sqlite:///{BASE_DIR / 'tradehub.db'}"

    # Gemini AI
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"

    # Gmail OAuth2 — resolved relative to backend dir
    GMAIL_CREDENTIALS_FILE: str = str(BASE_DIR / "credentials" / "gmail_credentials.json")
    GMAIL_TOKEN_FILE: str = str(BASE_DIR / "credentials" / "gmail_token.json")
    GMAIL_SCOPES: list = [
        "https://www.googleapis.com/auth/gmail.compose",
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/gmail.readonly",
    ]

    # Scraper
    REQUEST_TIMEOUT: int = 30
    MAX_RETRIES: int = 3
    SCRAPE_DELAY_SECONDS: float = 1.5  # Respectful delay between requests
    MAX_EVENTS_PER_SOURCE: int = 20
    MAX_LEADS_PER_EVENT: int = 50

    # Public base URL used for open-tracking pixel links (must be reachable
    # from the recipient's mail client; for local testing use a tunnel)
    TRACKING_BASE_URL: str = "http://localhost:8000"

    # CORS — accepts either JSON list or space/comma-separated string
    ALLOWED_ORIGINS: list = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
    ]

    @field_validator("ALLOWED_ORIGINS", mode="before")
    @classmethod
    def _split_origins(cls, v):
        if isinstance(v, str):
            import json as _json
            try:
                parsed = _json.loads(v)
                if isinstance(parsed, list):
                    return parsed
            except Exception:
                pass
            return [s for s in v.replace(",", " ").split() if s]
        return v

    class Config:
        env_file = str(BASE_DIR / ".env")
        env_file_encoding = "utf-8"
        extra = "ignore"


@lru_cache()
def get_settings() -> Settings:
    cfg = Settings()
    # Project .env values must win over machine-level environment variables:
    # stale GOOGLE_API_KEY / GEMINI_API_KEY entries in Windows/the shell would
    # otherwise silently override the key the user configured in backend/.env.
    dotenv_path = BASE_DIR / ".env"
    if dotenv_path.exists():
        from dotenv import dotenv_values

        values = dotenv_values(dotenv_path)
        dotenv_key = (values.get("GEMINI_API_KEY") or "").strip()
        if dotenv_key and dotenv_key != cfg.GEMINI_API_KEY:
            cfg.GEMINI_API_KEY = dotenv_key
        # Remove any machine-level keys leaked into the process env so the
        # Genai/GAuth SDKs never silently pick a different (possibly stale) key.
        if dotenv_key:
            os.environ["GEMINI_API_KEY"] = dotenv_key
        os.environ.pop("GOOGLE_API_KEY", None)
    # Force relative sqlite paths (e.g. sqlite:///./tradehub.db from .env) to resolve
    # against the backend directory so any process cwd works.
    if cfg.DATABASE_URL.startswith("sqlite:///") and "tradehub.db" in cfg.DATABASE_URL and ":" not in cfg.DATABASE_URL.split("///")[1]:
        db_path = cfg.DATABASE_URL.split("sqlite:///")[-1]
        if not Path(db_path).is_absolute():
            cfg.DATABASE_URL = f"sqlite:///{BASE_DIR / Path(db_path).name}"
    return cfg


settings = get_settings()

_level = getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO)
logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else _level,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
