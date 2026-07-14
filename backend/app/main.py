from contextlib import asynccontextmanager

from fastapi import FastAPI

from .db import engine
from .models import Base
from .routers import analysis, certificates


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Dev convenience: create tables on startup. Production applies
    # migrations/001_init.sql (which also locks the audit table down to
    # append-only) via the deployment pipeline instead.
    Base.metadata.create_all(engine)
    yield


app = FastAPI(
    title="Prowalco Calibration API",
    description="Signing service, audit trail, and Claude analysis proxy for the "
    "Prowalco calibration app. See CLAUDE.md at the repo root.",
    version="0.1.0",
    lifespan=lifespan,
)

app.include_router(certificates.router)
app.include_router(analysis.router)


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}
