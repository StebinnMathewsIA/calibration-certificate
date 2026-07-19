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
    signing_key_provider: str = "local"  # "local" | "aws_kms"
    signing_key_dir: str = str(BACKEND_DIR / "dev-keys")
    # Diskless hosts (e.g. Render): supply key material as base64 env vars —
    # takes precedence over signing_key_dir when set. With aws_kms only the
    # CERT vars apply (the private key never exists as a file).
    signing_key_pem_b64: str = ""
    signing_cert_pem_b64: str = ""
    signing_cert_chain_pem_b64: str = ""
    # aws_kms provider: the signing key lives in AWS KMS (non-exportable).
    aws_region: str = ""
    aws_kms_key_id: str = ""  # key ID, ARN, or alias/... name
    # PoC convenience: generate an ephemeral self-signed dev key at boot when
    # no key material exists. NOT for production — the key changes on every
    # restart/deploy (already-issued PDFs stay verifiable; they embed their
    # signing cert).
    signing_autogenerate_dev_key: bool = False
    tsa_url: str = ""

    # Claude analysis
    anthropic_model: str = "claude-opus-4-8"
    analysis_enabled: bool = True

    # Device binding (#51). Enforcement is flag-gated for a safe rollout:
    # off (default) verifies+audits device signatures when present but never
    # blocks; on requires a valid signature from an active enrolled device.
    device_binding_enforce: bool = False
    # Comma-separated emails allowed to approve/revoke device enrollments.
    admin_emails: str = ""

    @property
    def admin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.admin_emails.split(",") if e.strip()]


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
    if settings.signing_key_provider == "aws_kms":
        if not settings.aws_kms_key_id:
            problems.append("AWS_KMS_KEY_ID must be set when SIGNING_KEY_PROVIDER=aws_kms")
        has_cert_file = (Path(settings.signing_key_dir) / "kms-signing-cert.pem").exists()
        if not settings.signing_cert_pem_b64 and not has_cert_file:
            problems.append(
                "aws_kms provider needs SIGNING_CERT_PEM_B64 (or kms-signing-cert.pem "
                "in SIGNING_KEY_DIR) — run scripts/issue_cert_for_kms_key.py"
            )
    return problems
