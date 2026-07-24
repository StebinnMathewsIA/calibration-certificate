"""OnKey WOE001 export sync (#47).

Ported from Prowalco's existing export tooling. OnKey exposes a SOAP API:

    {BASE}/Authentication.svc  Logon(ConnectionName, UserName, Password)
                               -> SessionId; LogOff(SessionId)
    {BASE}/Export.svc          ExportData(ReportCode, DataSetName,
                               MaxRecordCount, Parameters[StartDate, EndDate])
                               -> XML dataset (rows of <field>value</field>)

The export caps at MaxRecordCount, so date ranges are pulled month-by-month
and auto-split to week/day chunks when a chunk hits the cap. Every row lands
verbatim (all columns) as jsonb in onkey_woe001, keyed by a content hash:
re-pulling a window is a no-op for unchanged rows, so a 5-minute incremental
poll writes only the delta the WOE001 interface can express.
"""
import hashlib
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings

SOAP_NS = "{http://contracts.pragmaproducts.com/onkey/System/v1}"
SOURCE_DATE_COLUMN = "StartDate"

# month -> week -> day, mirroring the proven export script.
_SPLIT_LEVELS = {"month": (31, "week"), "week": (7, "day"), "day": (1, None)}


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested without network or DB)
# ---------------------------------------------------------------------------


def parse_export_xml(xml_data: str) -> list[dict]:
    """Dataset XML -> list of row dicts (tag -> text), all columns kept."""
    root = ET.fromstring(xml_data)
    rows: list[dict] = []
    for record in root:
        rows.append({fld.tag: fld.text for fld in record})
    return rows


def row_content_hash(row: dict) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()


def parse_start_date(row: dict) -> datetime | None:
    raw = row.get(SOURCE_DATE_COLUMN)
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def split_date_range(start: datetime, end: datetime, chunk_days: int) -> list[tuple[datetime, datetime]]:
    ranges = []
    current = start
    while current <= end:
        chunk_end = min(
            current + timedelta(days=chunk_days - 1),
            end,
        ).replace(hour=23, minute=59, second=59, microsecond=0)
        ranges.append((current, chunk_end))
        current = (chunk_end + timedelta(seconds=1)).replace(microsecond=0)
    return ranges


def iter_export_chunks(
    fetch,  # (start: datetime, end: datetime) -> list[dict]
    start: datetime,
    end: datetime,
    max_records: int,
    level: str = "month",
):
    """Yield {hash: row} per leaf chunk; when a chunk hits the record cap,
    split it to the next-finer level. Streaming keeps memory bounded and lets
    the caller persist each chunk as it lands (durable backfill progress)."""
    chunk_days, next_level = _SPLIT_LEVELS[level]
    for chunk_start, chunk_end in split_date_range(start, end, chunk_days):
        rows = fetch(chunk_start, chunk_end)
        if len(rows) >= max_records and next_level is not None:
            yield from iter_export_chunks(fetch, chunk_start, chunk_end, max_records, next_level)
        else:
            yield {row_content_hash(row): row for row in rows}


def export_chunked(fetch, start, end, max_records: int, level: str = "month") -> dict[str, dict]:
    """All chunks merged (deduplicated) — used for small windows and tests."""
    rows_by_hash: dict[str, dict] = {}
    for chunk in iter_export_chunks(fetch, start, end, max_records, level):
        rows_by_hash.update(chunk)
    return rows_by_hash


# ---------------------------------------------------------------------------
# SOAP client (zeep)
# ---------------------------------------------------------------------------


class OnKeySoapClient:
    """Session-scoped OnKey SOAP access; use as a context manager."""

    def __init__(self, settings: Settings):
        if not settings.onkey_base_url or not settings.onkey_username or not settings.onkey_password:
            raise ValueError("ONKEY_BASE_URL, ONKEY_USERNAME and ONKEY_PASSWORD must be set")
        self._settings = settings
        self._session_id: str | None = None
        self._auth_service = None
        self._export_service = None
        self._export_client = None

    def __enter__(self) -> "OnKeySoapClient":
        from zeep import Client  # imported lazily: only the sync path needs it

        base = self._settings.onkey_base_url.rstrip("/")
        auth_client = Client(f"{base}/Authentication.svc?singleWsdl")
        self._auth_service = auth_client.create_service(
            f"{SOAP_NS}AuthenticationService_HttpsSoap11BasicBinding",
            f"{base}/Authentication.svc/basic",
        )
        response = self._auth_service.Logon(
            Credentials={
                "ConnectionName": self._settings.onkey_connection,
                "UserName": self._settings.onkey_username,
                "Password": self._settings.onkey_password,
            }
        )
        if getattr(response, "Errors", None):
            raise RuntimeError(f"OnKey login failed: {response.Errors}")
        self._session_id = response.SessionId

        self._export_client = Client(f"{base}/Export.svc?singleWsdl")
        self._export_service = self._export_client.create_service(
            f"{SOAP_NS}ExportService_HttpsSoap11BasicBinding",
            f"{base}/Export.svc/basic",
        )
        return self

    def __exit__(self, *exc_info) -> None:
        if self._session_id and self._auth_service is not None:
            try:
                self._auth_service.LogOff(_soapheaders={"SessionId": self._session_id})
            except Exception:  # noqa: BLE001 — logout is best-effort
                pass

    def export_window(self, start: datetime, end: datetime) -> list[dict]:
        parameter_type = self._export_client.get_type("ns0:ExportQueryParameter")
        parameter_array = self._export_client.get_type("ns0:ArrayOfExportQueryParameter")
        response = self._export_service.ExportData(
            _soapheaders={"SessionId": self._session_id},
            ReportCode=self._settings.onkey_report_code,
            DataSetName=self._settings.onkey_dataset_name,
            MaxRecordCount=self._settings.onkey_max_records,
            Parameters=parameter_array(
                [
                    parameter_type(Name="StartDate", Value=start),
                    parameter_type(Name="EndDate", Value=end),
                ]
            ),
        )
        if getattr(response, "Errors", None):
            raise RuntimeError(f"OnKey export failed: {response.Errors}")
        return parse_export_xml(response.DataSet.Data)


# ---------------------------------------------------------------------------
# Persistence + orchestration
# ---------------------------------------------------------------------------


@dataclass
class SyncSummary:
    mode: str
    window_start: str
    window_end: str
    rows_fetched: int = 0
    rows_inserted: int = 0
    rows_refreshed: int = 0
    columns: list[str] = field(default_factory=list)


def upsert_rows(db: Session, rows_by_hash: dict[str, dict]) -> tuple[int, int]:
    """Insert new rows; touch last_seen_at on ones already stored. Returns
    (inserted, refreshed)."""
    if not rows_by_hash:
        return (0, 0)
    hashes = list(rows_by_hash.keys())
    existing = {
        r[0]
        for r in db.execute(
            text("SELECT row_hash FROM onkey_woe001 WHERE row_hash = ANY(:hashes)"),
            {"hashes": hashes},
        )
    }
    new_hashes = [h for h in hashes if h not in existing]
    for h in new_hashes:
        row = rows_by_hash[h]
        ts = parse_start_date(row)
        db.execute(
            text(
                "INSERT INTO onkey_woe001 (row_hash, data, start_date_ts) "
                "VALUES (:h, cast(:data as jsonb), :ts) ON CONFLICT (row_hash) DO NOTHING"
            ),
            {"h": h, "data": json.dumps(row, default=str), "ts": ts},
        )
    if existing:
        db.execute(
            text("UPDATE onkey_woe001 SET last_seen_at = now() WHERE row_hash = ANY(:hashes)"),
            {"hashes": list(existing)},
        )
    db.commit()
    return (len(new_hashes), len(existing))


def run_sync(db: Session, settings: Settings, mode: str) -> SyncSummary:
    """mode 'incremental': rolling window (delta via content-hash dedupe);
    mode 'backfill': everything since ONKEY_BACKFILL_START."""
    end = datetime.now().replace(hour=23, minute=59, second=59, microsecond=0)
    if mode == "backfill":
        start = datetime.fromisoformat(settings.onkey_backfill_start)
    elif mode == "incremental":
        start = (end - timedelta(days=settings.onkey_sync_window_days)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    else:
        raise ValueError("mode must be 'incremental' or 'backfill'")

    summary = SyncSummary(mode=mode, window_start=start.isoformat(), window_end=end.isoformat())
    columns: set[str] = set()
    with OnKeySoapClient(settings) as client:
        # Persist per chunk: bounded memory, and a killed backfill keeps all
        # completed chunks (re-running skips them via the content hashes).
        for chunk in iter_export_chunks(
            client.export_window, start, end, settings.onkey_max_records
        ):
            if not chunk:
                continue
            inserted, refreshed = upsert_rows(db, chunk)
            summary.rows_fetched += len(chunk)
            summary.rows_inserted += inserted
            summary.rows_refreshed += refreshed
            for row in chunk.values():
                columns.update(row.keys())
    summary.columns = sorted(columns)
    return summary
