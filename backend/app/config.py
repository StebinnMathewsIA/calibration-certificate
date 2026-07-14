from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SHARED_SCHEMA_JSON_DIR = REPO_ROOT / "shared" / "schema" / "json"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    database_url: str = "sqlite:///./prowalco_dev.sqlite3"

    # Auth (OIDC broker)
    auth_mode: str = "disabled"  # "jwks" | "disabled" (dev only)
    auth_jwks_url: str = ""
    auth_issuer: str = ""
    auth_audience: str = ""

    # Signing
    signing_key_provider: str = "local"  # "local" | "aws_kms" | "azure_kv"
    signing_key_dir: str = str(BACKEND_DIR / "dev-keys")
    tsa_url: str = ""

    # Claude analysis
    anthropic_model: str = "claude-opus-4-8"
    analysis_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()
