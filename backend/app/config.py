from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SHARED_SCHEMA_JSON_DIR = REPO_ROOT / "shared" / "schema" / "json"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Supabase Postgres in production (see docs/supabase-setup.md);
    # local SQLite by default for dev and tests.
    database_url: str = "sqlite:///./prowalco_dev.sqlite3"

    # Auth: "supabase" verifies Supabase Auth JWTs (JWKS or legacy HS256
    # secret); "jwks" is a generic OIDC broker; "disabled" is dev only.
    auth_mode: str = "disabled"
    auth_jwks_url: str = ""
    auth_issuer: str = ""
    auth_audience: str = ""

    # Supabase project (auth + storage)
    supabase_url: str = ""  # https://<project-ref>.supabase.co
    supabase_service_role_key: str = ""  # server-only; NEVER in the app
    supabase_jwt_secret: str = ""  # only for legacy HS256 projects; prefer JWKS
    supabase_storage_bucket: str = "certificates"

    # Where signed PDFs live: "db" (dev/tests) | "supabase" (Storage bucket)
    pdf_storage: str = "db"

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
