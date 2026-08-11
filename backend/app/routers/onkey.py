"""OnKey sync endpoints (#47), driven by the scheduled GitHub Actions cron
(.github/workflows/onkey-sync.yml) every 5 minutes — which also keeps the
free-tier Render instance awake. Guarded by ONKEY_SYNC_TOKEN (empty token
disables the endpoints entirely).

BOTH modes run in a background thread and /status reports progress. The
incremental window used to run inline, which was fine for the narrow
WOE001 report; the 65-column FIELDOPS - WOE export outlives any sensible
client timeout, and a caller hanging up aborted the run before the
registers were derived. Raw rows landed, the registers stayed stale, and
nothing said so for three days. mode=derive rebuilds the registers from
rows already stored, without touching OnKey."""
import hmac
import json
import threading
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..config import Settings, get_settings
from ..db import SessionLocal, get_db
from ..workorders.onkey_sync import derive_registers, run_sync

router = APIRouter(prefix="/v1/onkey", tags=["onkey"])

# Single-flight guard + last outcome, per mode. Both incremental and
# backfill run in the background: a 65-column export outlives any
# sensible client timeout, and a caller hanging up used to abort the run
# before the registers were derived.
_backfill_lock = threading.Lock()
_backfill_state: dict = {"running": False, "last": None}
_sync_lock = threading.Lock()
_sync_state: dict = {"running": False, "last": None}
# The fast lane gets its OWN single-flight guard. Sharing the wide sweep's
# lock would starve it: the 35-day sweep runs for many minutes and every
# once-a-minute recent kick inside that span would be refused, which is
# exactly the staleness the fast lane exists to remove.
_recent_lock = threading.Lock()
_recent_state: dict = {"running": False, "last": None}


def _record_run(
    mode: str,
    state: str,
    started_at: datetime,
    *,
    rows_fetched: int = 0,
    rows_inserted: int = 0,
    detail: dict | None = None,
    error: str | None = None,
) -> None:
    """Write the run to onkey_sync_runs on its own session.

    The in-memory _sync_state is lost whenever Render restarts, so it
    cannot answer 'when did a sync last succeed'. That question is the
    whole alert: the three-day outage was invisible precisely because
    nothing durable recorded the failures. A separate session is used so
    a failed run's poisoned transaction cannot swallow its own record."""
    db = SessionLocal()
    try:
        db.execute(
            text(
                """
                INSERT INTO onkey_sync_runs (
                    id, run_kind, state, rows_fetched, rows_inserted,
                    detail, error, started_at, finished_at)
                VALUES (
                    gen_random_uuid(), :kind, :state, :fetched, :inserted,
                    CAST(:detail AS jsonb), :error, :started, now())
                """
            ),
            {
                "kind": mode,
                "state": state,
                "fetched": rows_fetched,
                "inserted": rows_inserted,
                "detail": json.dumps(detail or {}),
                "error": error,
                "started": started_at,
            },
        )
        db.commit()
    except Exception:  # noqa: BLE001 — bookkeeping must never fail a sync
        db.rollback()
    finally:
        db.close()


def _run_sync_background(settings: Settings, mode: str, state: dict, running_flag: dict) -> None:
    db = SessionLocal()
    started_at = datetime.now(timezone.utc)
    try:
        summary = run_sync(db, settings, mode)
        state["last"] = {
            "ok": True,
            "mode": summary.mode,
            "rowsFetched": summary.rows_fetched,
            "rowsInserted": summary.rows_inserted,
            "rowsRefreshed": summary.rows_refreshed,
            "registers": summary.registers,
            "window": {"start": summary.window_start, "end": summary.window_end},
            "finishedAt": datetime.now(timezone.utc).isoformat(),
        }
        _record_run(
            mode,
            "succeeded",
            started_at,
            rows_fetched=summary.rows_fetched,
            rows_inserted=summary.rows_inserted,
            detail={
                "rowsRefreshed": summary.rows_refreshed,
                "registers": summary.registers,
                "window": {"start": summary.window_start, "end": summary.window_end},
            },
        )
    except Exception as exc:  # noqa: BLE001 — reported via /status
        message = f"{type(exc).__name__}: {str(exc)[:500]}"
        state["last"] = {
            "ok": False,
            "mode": mode,
            "error": message,
            "finishedAt": datetime.now(timezone.utc).isoformat(),
        }
        _record_run(mode, "failed", started_at, error=message)
    finally:
        # Hand the OnKey session lease back the moment the run ends (#134).
        #
        # Nothing released it before, so it was held until it expired on
        # the clock, and the clock was set to 95 seconds against a sweep
        # that takes fifteen minutes. That is how two exports ended up in
        # one 512 MB process: the lease lapsed mid-sweep and the next
        # two-minutely job found it free.
        #
        # Releasing on completion lets the lease be set to a genuine upper
        # bound on the work instead of a guess that has to be short enough
        # not to stall the pipeline. Best effort on purpose: if this
        # fails, the expiry still frees it, and a sync that worked must
        # not be reported as failed because the release did not.
        try:
            _release_lease(mode)
        except Exception:  # noqa: BLE001 — the expiry is the safety net
            pass
        db.close()
        running_flag["running"] = False


def _release_lease(mode: str) -> None:
    session = SessionLocal()
    try:
        session.execute(
            text("SELECT onkey_release_session_lease(:holder)"), {"holder": f"sync:{mode}"}
        )
        session.commit()
    finally:
        session.close()


def _run_backfill_background(settings: Settings) -> None:
    _run_sync_background(settings, "backfill", _backfill_state, _backfill_state)


def _require_sync_token(authorization: str | None, settings: Settings) -> None:
    if not settings.onkey_sync_token:
        raise HTTPException(status_code=403, detail="OnKey sync is not enabled (ONKEY_SYNC_TOKEN unset)")
    expected = f"Bearer {settings.onkey_sync_token}"
    if not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=403, detail="Invalid sync token")


@router.post("/sync")
def sync(
    mode: str = Query(default="incremental", pattern="^(recent|incremental|backfill|derive)$"),
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

    if mode in ("incremental", "recent"):
        lock = _sync_lock if mode == "incremental" else _recent_lock
        state = _sync_state if mode == "incremental" else _recent_state
        with lock:
            if state["running"]:
                return {
                    "mode": mode,
                    "accepted": False,
                    "reason": f"a {mode} sync is already running",
                    "last": state["last"],
                }
            state["running"] = True
        threading.Thread(
            target=_run_sync_background,
            args=(settings, mode, state, state),
            daemon=True,
            name=f"onkey-{mode}",
        ).start()
        return {
            "mode": mode,
            "accepted": True,
            "note": "running in background — poll /v1/onkey/status",
            "last": state["last"],
        }

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
        "recent": {"running": _recent_state["running"], "last": _recent_state["last"]},
        "sync": {"running": _sync_state["running"], "last": _sync_state["last"]},
        "backfill": {"running": _backfill_state["running"], "last": _backfill_state["last"]},
        "health": _health(db, settings),
    }


# Modes that pull from OnKey. 'derive' only rebuilds registers from rows
# already stored, so a run of it says nothing about whether OnKey is
# reachable and must not count as a successful sync.
_PULL_MODES = ("recent", "incremental", "backfill")


def _health(db: Session, settings: Settings) -> dict:
    """Durable answer to 'is the work list current'. The scheduled workflow
    fails the job on stale=true, which is what turns a silent outage into a
    red run somebody sees.

    Freshness is measured on the REGISTER, not on whole runs. A pull walks
    the window newest-first and derives after every chunk, so the work list
    is current one chunk in while the run itself has minutes to go. Judging
    by completed runs called a healthy sync stale for as long as it took to
    finish. Every derive writes updated_at = now() unconditionally, so
    max(updated_at) moves whether or not any row changed, which is exactly
    the heartbeat wanted.

    Caveat: mode=derive rebuilds registers from stored rows and would also
    move it. That is a manual operator action, never scheduled, so it
    cannot mask an outage on its own; onkey_sync_runs below is what says
    whether OnKey was actually reachable."""
    last_run = db.execute(
        text(
            """
            SELECT run_kind, state, error, finished_at
              FROM onkey_sync_runs
             WHERE run_kind = ANY(:modes)
             ORDER BY started_at DESC
             LIMIT 1
            """
        ),
        {"modes": list(_PULL_MODES)},
    ).mappings().first()
    last_success = db.execute(
        text(
            """
            SELECT max(finished_at)
              FROM onkey_sync_runs
             WHERE run_kind = ANY(:modes) AND state = 'succeeded'
            """
        ),
        {"modes": list(_PULL_MODES)},
    ).scalar()
    now = datetime.now(timezone.utc)
    minutes = None
    if last_success is not None:
        minutes = round((now - last_success).total_seconds() / 60, 1)
    register_rows = db.execute(text("SELECT count(*) FROM onkey_workorders")).scalar() or 0
    register_updated = db.execute(text("SELECT max(updated_at) FROM onkey_workorders")).scalar()
    refresh_minutes = None
    if register_updated is not None:
        refresh_minutes = round((now - register_updated).total_seconds() / 60, 1)
    # A register that has never been derived is stale by definition: either
    # the service has never synced or the store was reset. Both need a human.
    stale = refresh_minutes is None or refresh_minutes > settings.onkey_stale_after_minutes
    return {
        "stale": stale,
        "staleAfterMinutes": settings.onkey_stale_after_minutes,
        "minutesSinceRefresh": refresh_minutes,
        "minutesSinceSuccess": minutes,
        "lastSuccessAt": last_success.isoformat() if last_success else None,
        "lastRun": {
            "mode": last_run["run_kind"],
            "state": last_run["state"],
            "error": last_run["error"],
            "finishedAt": last_run["finished_at"].isoformat() if last_run["finished_at"] else None,
        }
        if last_run
        else None,
        "workOrders": {
            "rows": register_rows,
            "lastUpdatedAt": register_updated.isoformat() if register_updated else None,
        },
    }
