from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from .config import get_settings, validate_settings
from .db import get_engine
from .pdf_store import SupabaseStoragePdfStore
from .routers import analysis, certificates, devices, onkey, workorders


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One architecture, everywhere: fail fast unless Supabase is configured,
    # the schema has been applied, and the storage bucket exists.
    settings = get_settings()
    problems = validate_settings(settings)
    if problems:
        raise RuntimeError(
            "Supabase configuration incomplete — see docs/supabase-setup.md:\n- "
            + "\n- ".join(problems)
        )

    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1 FROM certificates LIMIT 1"))
    except Exception as exc:  # noqa: BLE001 — any failure means the schema isn't ready
        raise RuntimeError(
            "Database schema not found or unreachable — apply it with: "
            "python scripts/apply_migrations.py"
        ) from exc

    SupabaseStoragePdfStore(
        settings.supabase_url,
        settings.supabase_service_role_key,
        settings.supabase_storage_bucket,
    ).ensure_bucket()

    yield


app = FastAPI(
    title="Prowalco Calibration API",
    description="Signing service, audit trail, and Claude analysis proxy for the "
    "Prowalco calibration app. Data platform: Supabase (Postgres, Storage, Auth). "
    "See CLAUDE.md at the repo root.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(certificates.router)
app.include_router(analysis.router)
app.include_router(workorders.router)
app.include_router(devices.router)
app.include_router(onkey.router)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}
