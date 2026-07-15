from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent
SHARED_SCHEMA_JSON_DIR = REPO_ROOT / "shared" / "schema" / "json"
PROMPTS_DIR = Path(__file__).resolve().parent / "prompts"
MIGRATIONS_DIR = BACKEND_DIR / "migrations"


class Settings(BaseSettings):
    """There is ONE architecture: Supabase Postgres + Supabase Storage +
    Supabase Auth, in every environment including tests. Startup fails fast
    if the Supabase configuration is missing (app/main.py)."""

    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Supabase Postgres connection string (session pooler, sslmode=require) —
    # see docs/supabase-setup.md.
    database_url: str = ""

    # Supabase project
    supabase_url: str = ""  # https://<project-ref>.supabase.co
    supabase_service_role_key: str = ""  # server-only; NEVER in the app
    supabase_anon_key: str = ""  # publishable; used by tests to sign in
    supabase_jwt_secret: str = ""  # only for legacy HS256 projects; prefer JWKS
    supabase_storage_bucket: str = "certificates"

    # Signing
    signing_key_provider: str = "local"  # "local" | "aws_kms" (stub)
    signing_key_dir: str = str(BACKEND_DIR / "dev-keys")
    # Diskless hosts (e.g. Render): supply key material as base64 env vars —
    # takes precedence over signing_key_dir when set.
    signing_key_pem_b64: str = ""
    signing_cert_pem_b64: str = ""
    # PoC convenience: generate an ephemeral self-signed dev key at boot when
    # no key material exists. NOT for production — the key changes on every
    # restart/deploy (already-issued PDFs stay verifiable; they embed their
    # signing cert).
    signing_autogenerate_dev_key: bool = False
    tsa_url: str = ""

    # Claude analysis
    anthropic_model: str = "claude-opus-4-8"
    analysis_enabled: bool = True


@lru_cache
def get_settings() -> Settings:
    return Settings()


def validate_settings(settings: Settings) -> list[str]:
    """Returns human-readable configuration problems (empty = OK)."""
    problems = []
    if not settings.database_url.startswith(("postgresql://", "postgresql+psycopg2://")):
        problems.append(
            "DATABASE_URL must be the Supabase Postgres connection string "
            "(postgresql+psycopg2://... — see docs/supabase-setup.md)"
        )
    if not settings.supabase_url.startswith("https://"):
        problems.append("SUPABASE_URL must be set (https://<project-ref>.supabase.co)")
    if not settings.supabase_service_role_key:
        problems.append("SUPABASE_SERVICE_ROLE_KEY must be set (server-only key)")
    return problems
