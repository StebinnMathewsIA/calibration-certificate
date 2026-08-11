"""Syspro read endpoints (#135). Guarded by the same sync token as the
OnKey endpoints; never reachable from the mobile app.

`/probe` exists to answer one question precisely: can this service read
Prowalco's Syspro, and if not, at which step does it stop. The connection
crosses a firewall allowlisted on a Render egress address, so the failure
modes are genuinely different from each other (a timeout is the allowlist,
a login error is the credential, a permission error is the grants) and a
single 500 would hide which one we are looking at."""
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query

from ..config import Settings, get_settings
from ..syspro import SysproError
from ..syspro.client import Q_CATALOGUE, SysproClient, probe as run_probe

router = APIRouter(prefix="/v1/syspro", tags=["syspro"])


def _require_sync_token(authorization: str | None, settings: Settings) -> None:
    if not settings.onkey_sync_token:
        raise HTTPException(status_code=403, detail="Sync token is not configured")
    expected = f"Bearer {settings.onkey_sync_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=403, detail="Invalid sync token")


def _require_configured(settings: Settings) -> None:
    if not settings.syspro_host:
        raise HTTPException(status_code=503, detail="Syspro is not configured (SYSPRO_HOST unset)")


@router.get("/probe")
def syspro_probe(
    sample: int = Query(default=20, ge=1, le=200),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_sync_token(authorization, settings)
    _require_configured(settings)
    return run_probe(settings, sample=sample)


@router.get("/catalogue")
def syspro_catalogue(
    limit: int = Query(default=500, ge=1, le=20000),
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    """The stock catalogue as Syspro has it, unmodified. Landing it in
    `stock_items` is a separate step: see it before storing it."""
    _require_sync_token(authorization, settings)
    _require_configured(settings)
    try:
        rows = SysproClient(settings).rows(Q_CATALOGUE, limit=limit)
    except SysproError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    return {"rowCount": len(rows), "limit": limit, "rows": rows}
