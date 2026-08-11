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
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..db import get_db
from ..syspro import SysproError
from ..syspro.ingest import load_state, run_load
from ..syspro.client import (
    SysproClient,
    diagnose as run_diagnose,
    probe as run_probe,
    q_catalogue,
)

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


@router.get("/diagnose")
def syspro_diagnose(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Where exactly a refused connection is refused: raw TCP first, then a
    matrix of encryption and TDS settings. FreeTDS reports a failed TLS
    negotiation, an unsupported TDS version and a rejected login with the
    same message, and those need different fixes."""
    _require_sync_token(authorization, settings)
    _require_configured(settings)
    return run_diagnose(settings)


@router.post("/load")
def syspro_load(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Pull the whole catalogue into `syspro_stock` and rebuild the parts
    register from it. Single-flight: two loads would fight over the same
    keyset and double the memory on an instance that already overruns."""
    _require_sync_token(authorization, settings)
    _require_configured(settings)
    try:
        return run_load(db, settings)
    except SysproError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None


@router.get("/status")
def syspro_status(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_sync_token(authorization, settings)
    last = db.execute(
        text(
            """
            SELECT id, started_at, finished_at, state, rows_seen, rows_written,
                   rows_rejected, warehouses, stock_codes, pages, error
              FROM syspro_loads ORDER BY id DESC LIMIT 1
            """
        )
    ).mappings().first()
    counts = db.execute(
        text(
            """
            SELECT (SELECT count(*) FROM syspro_stock)::int AS syspro_rows,
                   (SELECT count(*) FROM stock_items WHERE source = 'syspro')::int AS syspro_items,
                   (SELECT count(*) FROM stock_items WHERE source = 'onkey')::int AS onkey_items
            """
        )
    ).mappings().one()
    return {
        "configured": bool(settings.syspro_host),
        "lastLoad": dict(last) if last else None,
        "counts": dict(counts),
        "inFlight": load_state(),
    }


@router.get("/timing")
def syspro_timing(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Measure what a schedule can honestly be built on (#142).

    Reports the shape of `InvWarehouse.TimeStamp`, then times a full scan
    against an incremental pull. The incremental one is deliberately given
    a high-water mark that matches nothing, so it measures the PREDICATE
    rather than the size of the result: the question is whether the server
    can use the column at all, and a filter on this table has already
    turned out to be fifty times slower than no filter (#136)."""
    _require_sync_token(authorization, settings)
    _require_configured(settings)

    import time
    from decimal import Decimal

    from ..syspro.client import SysproClient
    from ..syspro.ingest import q_all_stock, q_changed_since, q_max_timestamp, q_timestamp_shape

    client = SysproClient(settings)
    database = settings.syspro_database
    out: dict = {}

    def jsonable(value):
        """A SQL Server rowversion arrives as raw bytes, which FastAPI
        cannot serialise: the first run of this endpoint returned a 500
        for exactly that reason, which was itself the answer about what
        the column is. Hex keeps it comparable and readable."""
        if isinstance(value, (bytes, bytearray)):
            return "0x" + bytes(value).hex().upper()
        if isinstance(value, Decimal):
            return float(value)
        return value

    def timed(name: str, sql: str, params=None, limit=None) -> None:
        began = time.monotonic()
        try:
            rows = client.rows(sql, params=params, limit=limit)
            out[name] = {
                "ok": True,
                "seconds": round(time.monotonic() - began, 2),
                "rowCount": len(rows),
                "sample": [{k: jsonable(v) for k, v in r.items()} for r in rows[:4]],
            }
        except SysproError as exc:
            out[name] = {"ok": False, "seconds": round(time.monotonic() - began, 2), "error": str(exc)}

    timed("columns", q_timestamp_shape(database))
    timed("maxTimestamp", q_max_timestamp(database))

    high_water = None
    if out.get("maxTimestamp", {}).get("ok"):
        # Re-read raw: the reported sample is hexed for JSON, and the
        # predicate needs the column's own type or the server will coerce
        # it and lose any chance of using an index.
        try:
            raw = client.rows(q_max_timestamp(database))
            high_water = raw[0].get("high_water") if raw else None
        except SysproError:
            high_water = None

    # First rows only. Time to FIRST ROW is what decides whether the server
    # streams or materialises, which is the thing that bit us before.
    timed("fullScanFirst5000", q_all_stock(database), limit=5000)
    if high_water is not None:
        timed("incrementalAtHighWater", q_changed_since(database), params=(high_water,), limit=5000)

    return out


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
        rows = SysproClient(settings).rows(q_catalogue(settings.syspro_database), limit=limit)
    except SysproError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from None
    return {"rowCount": len(rows), "limit": limit, "rows": rows}
