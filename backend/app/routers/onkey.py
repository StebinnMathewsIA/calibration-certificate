"""OnKey sync endpoints (#47), driven by the scheduled GitHub Actions cron
(.github/workflows/onkey-sync.yml) every 5 minutes — which also keeps the
free-tier Render instance awake. Guarded by ONKEY_SYNC_TOKEN (empty token
disables the endpoints entirely).

The incremental window is small and runs inline. Backfill spans years and
outlives Render's HTTP proxy window, so it runs in a background thread: the
endpoint returns 202 immediately and /status reports progress."""
import hmac
import json
import threading

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..workorders.onkey_sync import derive_registers, run_sync

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

    try:
        summary = run_sync(db, settings, mode)
    except Exception as exc:  # surfaced: a bare 500 here hid a 3-day outage
        raise HTTPException(
            status_code=502,
            detail=(
                f"sync failed in {type(exc).__name__}: {str(exc)[:600]} "
                f"[report={settings.onkey_report_code}]"
            ),
        ) from exc
    return {
        "mode": summary.mode,
        "window": {"start": summary.window_start, "end": summary.window_end},
        "rowsFetched": summary.rows_fetched,
        "rowsInserted": summary.rows_inserted,
        "rowsRefreshed": summary.rows_refreshed,
        "columns": summary.columns,
        "registers": summary.registers,
        # PII-free role counts (#71) — this response lands in public
        # workflow logs.
        "roles": _roles_summary(db),
    }


@router.get("/egress-ip")
def egress_ip(
    authorization: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> dict:
    """The public address this service connects OUT from.

    Prowalco's IT will allowlist this on their firewall so we can reach
    the Syspro SQL Server (docs/SYSPRO-INTEGRATION.md). Reading it from
    the host's own outbound connection is the only trustworthy way to
    get it: what a dashboard or a docs page claims and what a packet
    actually arrives as are two different things, and an allowlist built
    on the wrong one fails silently.

    A host may egress from several addresses, so call this repeatedly:
    every distinct answer has to be on the allowlist."""
    _require_sync_token(authorization, settings)
    import urllib.request

    seen: list[str] = []
    for url in ("https://api.ipify.org", "https://checkip.amazonaws.com"):
        try:
            with urllib.request.urlopen(url, timeout=10) as response:  # noqa: S310
                value = response.read().decode().strip()
            if value and value not in seen:
                seen.append(value)
        except Exception as exc:  # noqa: BLE001 — report, do not fail the call
            seen.append(f"{url} failed: {type(exc).__name__}")
    return {"egressAddresses": seen}


class ReportProbe(BaseModel):
    """Run ANY Analyser Report and land its rows in the generic snapshot
    store (#105). Used to evaluate new reports (e.g. FIELDOPS - WOE)
    before wiring them into the pipeline."""

    reportCode: str = Field(min_length=1, max_length=64)
    dataSetName: str | None = Field(default=None, max_length=64)
    maxRecords: int = Field(default=500, ge=1, le=5000)
    # Free-form Analyser parameters, e.g. {"StartDate": "2026-07-25"}.
    parameters: dict[str, str] = Field(default_factory=dict)


@router.post("/probe-report")
def probe_report(
    body: ReportProbe,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Fetch a report and persist its rows for inspection.

    The RESPONSE is deliberately PII-free (counts and column names only)
    because it lands in public workflow logs; the rows themselves go to
    onkey_report_rows, which is service-role only."""
    _require_sync_token(authorization, settings)

    from ..workorders.onkey_sync import OnKeySoapClient, parse_export_xml, row_content_hash

    with OnKeySoapClient(settings) as client:
        parameter_type = client._export_client.get_type("ns0:ExportQueryParameter")  # noqa: SLF001
        parameter_array = client._export_client.get_type("ns0:ArrayOfExportQueryParameter")  # noqa: SLF001
        try:
            response = client._export_service.ExportData(  # noqa: SLF001
                _soapheaders={"SessionId": client._session_id},  # noqa: SLF001
                ReportCode=body.reportCode,
                DataSetName=body.dataSetName or body.reportCode,
                MaxRecordCount=body.maxRecords,
                Parameters=parameter_array(
                    [parameter_type(Name=k, Value=v) for k, v in body.parameters.items()]
                ),
            )
        except Exception as exc:  # surfaced so a bad report is diagnosable from the probe
            raise HTTPException(
                status_code=502,
                detail=f"OnKey export raised {type(exc).__name__}: {str(exc)[:400]}",
            ) from exc
        if getattr(response, "Errors", None):
            raise HTTPException(status_code=502, detail=f"OnKey export failed: {response.Errors}")
        data = getattr(getattr(response, "DataSet", None), "Data", None)
        if not data:
            raise HTTPException(
                status_code=502,
                detail="OnKey export returned no DataSet.Data. Check the report's DataSetName "
                "matches the report code and that Is For Export is ticked.",
            )
        try:
            rows = parse_export_xml(data)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Could not parse the export XML: {type(exc).__name__}: {str(exc)[:300]}",
            ) from exc

    inserted = 0
    for row in rows:
        result = db.execute(
            text(
                "INSERT INTO onkey_report_rows (report_code, row_hash, data, last_seen_at) "
                "VALUES (:code, :h, cast(:data as jsonb), now()) "
                "ON CONFLICT (report_code, row_hash) DO UPDATE SET last_seen_at = now()"
            ),
            {
                "code": body.reportCode,
                "h": row_content_hash(row),
                "data": json.dumps(row, default=str),
            },
        )
        inserted += result.rowcount or 0
    db.commit()

    columns: set[str] = set()
    for row in rows:
        columns.update(row.keys())
    return {
        "reportCode": body.reportCode,
        "rowsFetched": len(rows),
        "rowsStored": inserted,
        "columns": sorted(columns),
    }


def _roles_summary(db: Session) -> dict:
    rows = db.execute(
        text("SELECT role, count(*) FROM app_roles GROUP BY role")
    ).all()
    return {role: n for role, n in rows}


class SitePatch(BaseModel):
    """Gap edits a signed-in technician may make to a site (#60)."""

    gpsLocation: str | None = Field(default=None, max_length=200)
    address: str | None = Field(default=None, max_length=400)
    telephone: str | None = Field(default=None, max_length=64)


@router.patch("/sites/{site_number}")
def patch_site(
    site_number: str,
    body: SitePatch,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    """Fill register gaps by hand. Fields set here are recorded in
    manual_fields and are never overwritten by the sync again."""
    updates = {
        column: value.strip()
        for column, value in {
            "gps_location": body.gpsLocation,
            "address": body.address,
            "telephone": body.telephone,
        }.items()
        if value is not None and value.strip()
    }
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    exists = db.execute(
        text("SELECT 1 FROM onkey_sites WHERE site_number = :sn"), {"sn": site_number}
    ).scalar()
    if not exists:
        raise HTTPException(status_code=404, detail="Unknown site")
    set_clause = ", ".join(f"{column} = :{column}" for column in updates)
    db.execute(
        text(
            f"UPDATE onkey_sites SET {set_clause}, "  # noqa: S608 — fixed column names
            "manual_fields = manual_fields || cast(:mkeys as jsonb), "
            "manual_updated_by = :by, manual_updated_at = now(), updated_at = now() "
            "WHERE site_number = :sn"
        ),
        {
            **updates,
            "mkeys": json.dumps({column: True for column in updates}),
            "by": identity.email or identity.subject,
            "sn": site_number,
        },
    )
    db.commit()
    return {"siteNumber": site_number, "updated": sorted(updates), "manual": True}


class MasterLocation(BaseModel):
    code: str = Field(max_length=120)
    description: str | None = Field(default=None, max_length=300)
    gps_location: str | None = Field(default=None, max_length=200)
    branch: str | None = Field(default=None, max_length=16)
    address: str | None = Field(default=None, max_length=400)
    location_code: str | None = Field(default=None, max_length=64)
    is_active: bool | None = None


class MasterTechnician(BaseModel):
    email: str = Field(max_length=320)
    display_name: str | None = Field(default=None, max_length=200)
    first_name: str | None = Field(default=None, max_length=100)
    last_name: str | None = Field(default=None, max_length=100)
    manager: str | None = Field(default=None, max_length=200)
    latitude: float | None = None
    longitude: float | None = None


class MastersBody(BaseModel):
    """One chunk of master data (#69). The caller sets derive=true on the
    LAST chunk so the fill-blanks enrichment runs once."""

    locations: list[MasterLocation] = Field(default_factory=list, max_length=2000)
    technicians: list[MasterTechnician] = Field(default_factory=list, max_length=2000)
    derive: bool = False


@router.post("/masters")
def load_masters(
    body: MastersBody,
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Upserts AllLocations / Technician master rows (#59 data, #69 load).

    The master DATA never enters the public repo — it arrives as an opaque
    workflow-dispatch payload (masters-load.yml) and this response carries
    counts only, so workflow logs stay PII-free."""
    _require_sync_token(authorization, settings)
    if body.locations:
        db.execute(
            text(
                "INSERT INTO onkey_location_master "
                "(code, description, gps_location, branch, address, location_code, is_active) "
                "VALUES (:code, :description, :gps_location, :branch, :address, :location_code, :is_active) "
                "ON CONFLICT (code) DO UPDATE SET description=EXCLUDED.description, "
                "gps_location=EXCLUDED.gps_location, branch=EXCLUDED.branch, "
                "address=EXCLUDED.address, location_code=EXCLUDED.location_code, "
                "is_active=EXCLUDED.is_active, loaded_at=now()"
            ),
            [loc.model_dump() for loc in body.locations],
        )
    if body.technicians:
        db.execute(
            text(
                "INSERT INTO onkey_technician_master "
                "(email, display_name, first_name, last_name, manager, latitude, longitude) "
                "VALUES (:email, :display_name, :first_name, :last_name, :manager, :latitude, :longitude) "
                "ON CONFLICT (email) DO UPDATE SET display_name=EXCLUDED.display_name, "
                "first_name=EXCLUDED.first_name, last_name=EXCLUDED.last_name, "
                "manager=EXCLUDED.manager, latitude=EXCLUDED.latitude, "
                "longitude=EXCLUDED.longitude, loaded_at=now()"
            ),
            [tech.model_dump() for tech in body.technicians],
        )
    db.commit()
    registers = derive_registers(db) if body.derive else None
    coverage = {
        "locationMasterRows": db.execute(
            text("SELECT count(*) FROM onkey_location_master")
        ).scalar(),
        "technicianMasterRows": db.execute(
            text("SELECT count(*) FROM onkey_technician_master")
        ).scalar(),
        "sitesWithAddress": db.execute(
            text("SELECT count(*) FROM onkey_sites WHERE coalesce(address, '') <> ''")
        ).scalar(),
        "sitesTotal": db.execute(text("SELECT count(*) FROM onkey_sites")).scalar(),
    }
    return {
        "locationsUpserted": len(body.locations),
        "techniciansUpserted": len(body.technicians),
        "derived": registers,
        "coverage": coverage,
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
