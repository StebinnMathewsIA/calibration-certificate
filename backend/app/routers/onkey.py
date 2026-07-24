"""OnKey sync endpoints (#47), driven by the scheduled GitHub Actions cron
(.github/workflows/onkey-sync.yml) every 5 minutes — which also keeps the
free-tier Render instance awake. Guarded by ONKEY_SYNC_TOKEN (empty token
disables the endpoints entirely).

The incremental window is small and runs inline. Backfill spans years and
outlives Render's HTTP proxy window, so it runs in a background thread: the
endpoint returns 202 immediately and /status reports progress."""
import hmac
import threading

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..workorders.onkey_sync import run_sync

router = APIRouter(prefix="/v1/onkey", tags=["onkey"])

# Single-flight guard + last outcome for the background backfill.
_backfill_lock = threading.Lock()
_backfill_state: dict = {"running": False, "last": None}


def _run_backfill_background(settings: Settings) -> None:
    db = SessionLocal()
    try:
        summary = run_sync(db, settings, "backfill")
        _backfill_state["last"] = {
            "ok": True,
            "rowsFetched": summary.rows_fetched,
            "rowsInserted": summary.rows_inserted,
            "columns": summary.columns,
            "window": {"start": summary.window_start, "end": summary.window_end},
        }
    except Exception as exc:  # noqa: BLE001 — reported via /status
        _backfill_state["last"] = {"ok": False, "error": str(exc)[:500]}
    finally:
        db.close()
        _backfill_state["running"] = False


def _require_sync_token(authorization: str | None, settings: Settings) -> None:
    if not settings.onkey_sync_token:
        raise HTTPException(status_code=403, detail="OnKey sync is not enabled (ONKEY_SYNC_TOKEN unset)")
    expected = f"Bearer {settings.onkey_sync_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=403, detail="Invalid sync token")


@router.post("/sync")
def sync(
    mode: str = Query(default="incremental", pattern="^(incremental|backfill)$"),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_sync_token(authorization, settings)

    if mode == "backfill":
        with _backfill_lock:
            if _backfill_state["running"]:
                return {"mode": "backfill", "accepted": False, "reason": "backfill already running"}
            _backfill_state["running"] = True
        threading.Thread(
            target=_run_backfill_background, args=(settings,), daemon=True, name="onkey-backfill"
        ).start()
        return {"mode": "backfill", "accepted": True, "note": "running in background — poll /v1/onkey/status"}

    summary = run_sync(db, settings, mode)
    return {
        "mode": summary.mode,
        "window": {"start": summary.window_start, "end": summary.window_end},
        "rowsFetched": summary.rows_fetched,
        "rowsInserted": summary.rows_inserted,
        "rowsRefreshed": summary.rows_refreshed,
        "columns": summary.columns,
    }


@router.get("/status")
def status(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_sync_token(authorization, settings)
    total = db.execute(text("SELECT count(*) FROM onkey_woe001")).scalar() or 0
    last_seen = db.execute(text("SELECT max(last_seen_at) FROM onkey_woe001")).scalar()
    sample = db.execute(
        text("SELECT data FROM onkey_woe001 ORDER BY last_seen_at DESC LIMIT 1")
    ).scalar()
    return {
        "rows": total,
        "lastSeenAt": last_seen.isoformat() if last_seen else None,
        "columns": sorted(sample.keys()) if isinstance(sample, dict) else [],
        "backfill": {"running": _backfill_state["running"], "last": _backfill_state["last"]},
    }
