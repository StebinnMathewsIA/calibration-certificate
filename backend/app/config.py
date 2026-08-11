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

    # OnKey work-order integration (#47). Credentials are server-side only —
    # set in Render's Environment (never in the repo, never in the app).
    # 'simulated' serves the fixtures; flip to 'onkey' once the provider's
    # field mapping lands (blocked on the OnKey API documentation).
    workorder_provider: str = "simulated"  # "simulated" | "onkey"
    onkey_base_url: str = ""
    onkey_username: str = ""
    onkey_password: str = ""
    # Work order export sync (SOAP). FIELDOPS - WOE succeeds WOE001: same
    # column names for everything the registers read, plus ImportanceCode,
    # the work order's own status, site name, staff email and asset GPS.
    # Set ONKEY_REPORT_CODE and ONKEY_DATASET_NAME back to WOE001 to revert.
    onkey_connection: str = "ONKEY"
    onkey_report_code: str = "FIELDOPS - WOE"
    onkey_dataset_name: str = "FIELDOPS - WOE"
    onkey_max_records: int = 5000
    # FIELDOPS - WOE declares parameters that are NOT optional: omitting one
    # leaves it NULL, every LIKE against it is false, and the export returns
    # zero rows with no error. StartDate and EndDate are supplied per window.
    onkey_export_parameters: str = (
        '{"BaseStatus": "%", "StaffEmail": "%", "SiteCode": "%", "MinId": "0"}'
    )
    # Bearer token the sync endpoints require (the scheduled GitHub Actions
    # cron presents it). Empty = sync endpoints disabled.
    onkey_sync_token: str = ""
    # Incremental pulls re-fetch this rolling window; content-hash dedupe
    # makes unchanged rows no-ops, so only the delta is written.
    onkey_sync_window_days: int = 35
    onkey_backfill_start: str = "2024-01-01"
    # /v1/onkey/status calls the sync stale once this many minutes have
    # passed with no register refresh, and the scheduled workflow fails on
    # that flag. 30 is right now that pg_cron drives the pull every minute
    # (migration 041) and actually honours its interval; GitHub's schedule,
    # which fired every 1 to 3 hours, is only the monitor.
    onkey_stale_after_minutes: int = 30
    # The fast lane. Technicians are on site and need the planner's latest
    # assignment, so the routine pull is a NARROW window run every minute
    # rather than the 35-day sweep run occasionally. Two days covers a
    # weekend of changes with a few hundred rows.
    onkey_recent_window_days: int = 2

    # Syspro stock catalogue (#135), read-only. Values live in Render's
    # Environment, never here: this repository is public and the server
    # sits behind nothing but a source IP allowlist (#133). Empty host
    # disables the endpoints entirely, which is the state in CI and local
    # dev. SYSPRO_PASSWORD is empty on purpose, because the login Prowalco
    # issued has no password; that is recorded, not endorsed.
    syspro_host: str = ""
    syspro_port: int = 1433
    # Prowalco's South African company database, owner-supplied. Lesotho is
    # a second database, SysproCompanyH, which we do not pull: every van
    # warehouse we have mapped is RSA. Defaulted here rather than left to
    # the environment because a database name is not a credential, and
    # every environment change on Render restarts the service and moves
    # its outbound address (#133), so the fewer variables to set the
    # better.
    syspro_database: str = "SysproCompanyRSA"
    syspro_user: str = ""
    syspro_password: str = ""
    # Measured against the live endpoint, not chosen. Everything from
    # FreeTDS's modern default down to TDS 7.1 is refused with error 20002;
    # only 7.0 with encryption off completes the handshake, and only when
    # the database is left out of the login packet. Whether that is an old
    # SQL Server or the port forward mangling the modern pre-login
    # handshake is an open question for Prowalco IT (#135). Re-run
    # /v1/syspro/diagnose after any change on their side: a newer version
    # would be better, since TDS 7.0 predates several data types.
    syspro_tds_version: str = "7.0"
    syspro_encryption: str = "off"
    # The forward crosses a VPN, so a first packet is slower than a LAN
    # connection would be, and a stale allowlist shows up as a timeout
    # rather than a refusal. Long enough to distinguish the two.
    syspro_login_timeout: int = 30
    syspro_query_timeout: int = 120

    # Device binding (#51). Enforcement is flag-gated for a safe rollout:
    # off (default) verifies+audits device signatures when present but never
    # blocks; on requires a valid signature from an active enrolled device.
    device_binding_enforce: bool = False
    # Comma-separated emails allowed to approve/revoke device enrollments.
    admin_emails: str = ""

    # Customer certificate email (Arch v2 phase 3, #67). False (PoC): rows in
    # certificate_emails are written as 'held' — no send is attempted until
    # the @prowalco.co.za sending domain exists. True: rows queue for
    # dispatch (the sender itself ships with activation, post-PoC).
    email_enabled: bool = False

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
