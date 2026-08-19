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
import io
import json
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings

SOAP_NS = "{http://contracts.pragmaproducts.com/onkey/System/v1}"
# The export's own timestamp column (StartDate/EndDate are only the query
# parameter names; the output carries the queue-transition time). The
# queue join is a left outer one, so a work order that has never been
# queued has no transition time and falls back to its own LastModifiedOn,
# which is exactly what the FIELDOPS - WOE where-clause filters on.
SOURCE_DATE_COLUMN = "WorkOrderQueueStatusChangedOn"
SOURCE_DATE_FALLBACK = "WorkOrderLastModifiedOn"

# month -> week -> day, mirroring the proven export script.
_SPLIT_LEVELS = {"month": (31, "week"), "week": (7, "day"), "day": (1, None)}


# ---------------------------------------------------------------------------
# Pure helpers (unit-tested without network or DB)
# ---------------------------------------------------------------------------


def parse_export_xml(xml_data: str) -> list[dict]:
    """Dataset XML -> list of row dicts (tag -> text), all columns kept.

    Streamed with iterparse rather than ET.fromstring (#134). This parser
    runs every two minutes on the recent sync, and building the full DOM
    held the raw XML string AND a tree several times its size at the same
    moment, on an instance with little headroom: the repeated peak is what
    kept tripping Render's memory limit. iterparse walks the document and
    frees each record as soon as its dict is taken, so the peak is the
    string plus one record."""
    rows: list[dict] = []
    depth = 0
    fields: dict | None = None
    for event, elem in ET.iterparse(io.StringIO(xml_data), events=("start", "end")):
        if event == "start":
            depth += 1
            if depth == 2:
                fields = {}
        else:
            depth -= 1
            if depth == 2 and fields is not None:
                # A field of the current record closed.
                fields[elem.tag] = elem.text
            elif depth == 1 and fields is not None:
                # The record itself closed: take the dict, free the tree.
                rows.append(fields)
                fields = None
                elem.clear()
    return rows


def _param_date(value: datetime) -> str:
    """An Analyser DateTime parameter, as the report expects it.

    Naive ISO seconds. Anything carrying a timezone offset is refused
    with E5044, which says nothing about the cause."""
    return value.replace(tzinfo=None).strftime("%Y-%m-%dT%H:%M:%S")


def row_content_hash(row: dict) -> str:
    return hashlib.sha256(json.dumps(row, sort_keys=True, default=str).encode()).hexdigest()


def parse_start_date(row: dict) -> datetime | None:
    raw = row.get(SOURCE_DATE_COLUMN) or row.get(SOURCE_DATE_FALLBACK)
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
    the caller persist each chunk as it lands (durable backfill progress).
    Chunks run NEWEST-FIRST so the current month — the data the app needs —
    is persisted within minutes; history fills in behind it."""
    chunk_days, next_level = _SPLIT_LEVELS[level]
    for chunk_start, chunk_end in reversed(split_date_range(start, end, chunk_days)):
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
        from zeep import Client, Settings  # imported lazily: only the sync path needs it

        # OnKey returns the WHOLE dataset as one escaped text node inside
        # <Data>. libxml2 caps a single text node at 10 MB, so a wide
        # report fails with "Text node too long, try XML_PARSE_HUGE" even
        # though the response is perfectly valid. WOE001 was narrow enough
        # to stay under it; FIELDOPS - WOE has 65 columns and is not.
        # xml_huge_tree lifts the cap. It applies to BOTH clients, since
        # the export response is the large one but the setting is
        # per-client.
        zeep_settings = Settings(xml_huge_tree=True)

        base = self._settings.onkey_base_url.rstrip("/")
        auth_client = Client(f"{base}/Authentication.svc?singleWsdl", settings=zeep_settings)
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

        self._export_client = Client(f"{base}/Export.svc?singleWsdl", settings=zeep_settings)
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

    def _extra_parameters(self) -> dict[str, str]:
        """Non-optional report parameters beyond the date window. A report
        that declares a parameter and is not sent one leaves it NULL, so
        every LIKE against it is false and the export returns zero rows
        with no error at all. Misconfiguration here looks like silence."""
        raw = getattr(self._settings, "onkey_export_parameters", "") or ""
        if not raw.strip():
            return {}
        try:
            parsed = json.loads(raw)
        except ValueError:
            return {}
        return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}

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
                    # Dates go as PLAIN STRINGS, no timezone suffix. Value
                    # is a string field, so a datetime gets serialised as
                    # an offset-aware ISO stamp ("...+00:00") which the
                    # Analyser rejects with a bare E5044. The probe calls
                    # that work send strings, and this matches them.
                    parameter_type(Name="StartDate", Value=_param_date(start)),
                    parameter_type(Name="EndDate", Value=_param_date(end)),
                ]
                + [
                    parameter_type(Name=name, Value=value)
                    for name, value in self._extra_parameters().items()
                ]
            ),
        )
        if getattr(response, "Errors", None):
            raise RuntimeError(f"OnKey export failed: {response.Errors}")
        return parse_export_xml(response.DataSet.Data)

    def export_probe(self) -> dict:
        """FIELDOPS - PROBE (#180): one row, the two change watermarks and
        a total count, no parameters. The cheap question asked before the
        expensive export."""
        parameter_array = self._export_client.get_type("ns0:ArrayOfExportQueryParameter")
        response = self._export_service.ExportData(
            _soapheaders={"SessionId": self._session_id},
            ReportCode=self._settings.onkey_probe_report_code,
            DataSetName=self._settings.onkey_dataset_name,
            MaxRecordCount=1,
            Parameters=parameter_array([]),
        )
        if getattr(response, "Errors", None):
            raise RuntimeError(f"OnKey probe failed: {response.Errors}")
        rows = parse_export_xml(response.DataSet.Data)
        return rows[0] if rows else {}

    def export_delta(self, since: datetime, min_id: int) -> list[dict]:
        """FIELDOPS - WOE DELTA (#180): everything modified since the
        cursor, on either the work order's own timestamp or its queue
        row's. Same 65 columns as FIELDOPS - WOE, so row hashes match and
        both lanes share onkey_woe001. Paged by MinId like the original."""
        parameter_type = self._export_client.get_type("ns0:ExportQueryParameter")
        parameter_array = self._export_client.get_type("ns0:ArrayOfExportQueryParameter")
        extras = self._extra_parameters()
        extras.pop("MinId", None)  # paged here, not fixed from config
        response = self._export_service.ExportData(
            _soapheaders={"SessionId": self._session_id},
            ReportCode=self._settings.onkey_delta_report_code,
            DataSetName=self._settings.onkey_dataset_name,
            MaxRecordCount=self._settings.onkey_max_records,
            Parameters=parameter_array(
                [
                    parameter_type(Name="Since", Value=_param_date(since)),
                    parameter_type(Name="MinId", Value=str(min_id)),
                ]
                + [
                    parameter_type(Name=name, Value=value)
                    for name, value in extras.items()
                ]
            ),
        )
        if getattr(response, "Errors", None):
            raise RuntimeError(f"OnKey delta export failed: {response.Errors}")
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
    registers: dict = field(default_factory=dict)


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
        # Stamp at most hourly (#172): the stamp only exists so the freshest
        # snapshot of a work order wins the derivation (#130), and a change
        # always arrives as a NEW row with a fresh stamp. Re-stamping 624
        # unchanged rows every two minutes was ~450k dead tuples a day.
        db.execute(
            text(
                "UPDATE onkey_woe001 SET last_seen_at = now() "
                "WHERE row_hash = ANY(:hashes) AND last_seen_at < now() - interval '1 hour'"
            ),
            {"hashes": list(existing)},
        )
    db.commit()
    return (len(new_hashes), len(existing))


# SQL casts abort on malformed values; WOE001 dates are ISO-with-offset, and
# this guard keeps one stray value from failing the whole derivation.
_SAFE_TS = """
CASE WHEN {col} ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}' THEN ({col})::timestamptz ELSE NULL END
"""


def _ts(col_expr: str) -> str:
    return _SAFE_TS.format(col=col_expr)


def derive_registers(db: Session, row_hashes: list[str] | None = None) -> dict:
    """Mine the raw WOE001 snapshot log into the technician / site /
    equipment / current-work-order registers (#54). Latest queue transition
    per work order Code wins. Idempotent — runs after every sync.

    CHURN RULES (#172). This used to rewrite every register row on every
    two-minute cycle (~21 million row versions a day), which is what was
    starving the database. Two rules now:

    1. Every write carries a change guard: a row whose derived values
       equal its current values is not written at all.
    2. The recent lane passes the row hashes it just fetched and only
       those rows are scanned. Windowing is ONLY safe for the recent
       lane: its window is the present, so a code's freshest snapshot is
       always inside it. The wide sweep and backfill walk OLD windows,
       where a chunk's best row can be years stale, so they keep the
       full scan (the guards still stop their writes) and the full
       DISTINCT ON keeps electing the globally freshest row."""
    win = "AND row_hash = ANY(:hashes)" if row_hashes is not None else ""
    params = {"hashes": row_hashes} if row_hashes is not None else {}

    # Backfill the event-timestamp index for rows synced before the column fix.
    db.execute(
        text(
            "UPDATE onkey_woe001 SET start_date_ts = "
            + _ts("data->>'WorkOrderQueueStatusChangedOn'")
            + " WHERE start_date_ts IS NULL AND data ? 'WorkOrderQueueStatusChangedOn'"
        )
    )

    db.execute(
        text(
            f"""
            INSERT INTO onkey_technicians (staff_code, name, email, updated_at)
            SELECT DISTINCT ON (data->>'StaffCode')
                   data->>'StaffCode',
                   nullif(data->>'StaffDescription', ''),
                   nullif(data->>'StaffEmail', ''),
                   now()
            FROM onkey_woe001
            WHERE coalesce(data->>'StaffCode', '') <> '' {win}
            ORDER BY data->>'StaffCode', start_date_ts DESC NULLS LAST
            ON CONFLICT (staff_code) DO UPDATE SET
                name = coalesce(EXCLUDED.name, onkey_technicians.name),
                email = coalesce(EXCLUDED.email, onkey_technicians.email),
                updated_at = now()
            WHERE (onkey_technicians.name, onkey_technicians.email) IS DISTINCT FROM
                  (coalesce(EXCLUDED.name, onkey_technicians.name),
                   coalesce(EXCLUDED.email, onkey_technicians.email))
            """
        ),
        params,
    )

    db.execute(
        text(
            f"""
            INSERT INTO onkey_sites (site_number, site_name, branch_code,
                                     gps_location, oil_company_code, oil_company_name, updated_at)
            SELECT DISTINCT ON (data->>'SiteNumber')
                   data->>'SiteNumber',
                   nullif(data->>'SiteName', ''),
                   nullif(data->>'BranchCodeLocation', ''),
                   nullif(data->>'AssetParentAssetGeographicDataLocationNonShell', ''),
                   nullif(data->>'WorkOrderSiteCode', ''),
                   nullif(data->>'WorkOrderSiteDescription', ''),
                   now()
            FROM onkey_woe001
            WHERE coalesce(data->>'SiteNumber', '') <> '' {win}
            ORDER BY data->>'SiteNumber', start_date_ts DESC NULLS LAST
            ON CONFLICT (site_number) DO UPDATE SET
                site_name = coalesce(EXCLUDED.site_name, onkey_sites.site_name),
                branch_code = coalesce(EXCLUDED.branch_code, onkey_sites.branch_code),
                -- Manual gap edits (#60) always win over synced data.
                gps_location = CASE WHEN onkey_sites.manual_fields ? 'gps_location'
                                    THEN onkey_sites.gps_location
                                    ELSE coalesce(EXCLUDED.gps_location, onkey_sites.gps_location) END,
                oil_company_code = coalesce(EXCLUDED.oil_company_code, onkey_sites.oil_company_code),
                oil_company_name = coalesce(EXCLUDED.oil_company_name, onkey_sites.oil_company_name),
                updated_at = now()
            WHERE (onkey_sites.site_name, onkey_sites.branch_code, onkey_sites.gps_location,
                   onkey_sites.oil_company_code, onkey_sites.oil_company_name) IS DISTINCT FROM
                  (coalesce(EXCLUDED.site_name, onkey_sites.site_name),
                   coalesce(EXCLUDED.branch_code, onkey_sites.branch_code),
                   CASE WHEN onkey_sites.manual_fields ? 'gps_location'
                        THEN onkey_sites.gps_location
                        ELSE coalesce(EXCLUDED.gps_location, onkey_sites.gps_location) END,
                   coalesce(EXCLUDED.oil_company_code, onkey_sites.oil_company_code),
                   coalesce(EXCLUDED.oil_company_name, onkey_sites.oil_company_name))
            """
        ),
        params,
    )

    db.execute(
        text(
            f"""
            INSERT INTO onkey_equipment (equipment_number, site_number, description, updated_at)
            SELECT DISTINCT ON (data->>'EquipmentNumber')
                   data->>'EquipmentNumber',
                   nullif(data->>'SiteNumber', ''),
                   nullif(data->>'WorkOrderAssetParentAssetParentAssetDescription', ''),
                   now()
            FROM onkey_woe001
            WHERE coalesce(data->>'EquipmentNumber', '') <> '' {win}
            ORDER BY data->>'EquipmentNumber', start_date_ts DESC NULLS LAST
            ON CONFLICT (equipment_number) DO UPDATE SET
                site_number = coalesce(EXCLUDED.site_number, onkey_equipment.site_number),
                description = coalesce(EXCLUDED.description, onkey_equipment.description),
                updated_at = now()
            WHERE (onkey_equipment.site_number, onkey_equipment.description) IS DISTINCT FROM
                  (coalesce(EXCLUDED.site_number, onkey_equipment.site_number),
                   coalesce(EXCLUDED.description, onkey_equipment.description))
            """
        ),
        params,
    )

    db.execute(
        text(
            f"""
            INSERT INTO onkey_workorders (
                code, status_code, status_description, status_changed_on,
                staff_code, site_number, equipment_number,
                received_on, required_by, complete_by, completed_on,
                contract_type, work_required, work_performed,
                estimated_duration_minutes, updated_at)
            SELECT DISTINCT ON (data->>'Code')
                   data->>'Code',
                   nullif(data->>'WorkOrderQueueNewStatusCode', ''),
                   nullif(data->>'WorkOrderQueueNewStatusDescription', ''),
                   {_ts("data->>'WorkOrderQueueStatusChangedOn'")},
                   nullif(data->>'StaffCode', ''),
                   nullif(data->>'SiteNumber', ''),
                   nullif(data->>'EquipmentNumber', ''),
                   {_ts("data->>'ReceivedOn'")},
                   {_ts("data->>'RequiredBy'")},
                   {_ts("data->>'CompleteBy'")},
                   {_ts("data->>'CompletedOn'")},
                   nullif(data->>'ContractType', ''),
                   nullif(data->>'WorkRequired', ''),
                   nullif(data->>'WorkPerformed', ''),
                   CASE WHEN data->>'EstimatedDurationInMinutes' ~ '^[0-9]+$'
                        THEN (data->>'EstimatedDurationInMinutes')::int END,
                   now()
            FROM onkey_woe001
            WHERE coalesce(data->>'Code', '') <> '' {win}
            -- last_seen_at FIRST (#130). A work order's start date does not
            -- change when the record is updated, so ordering by it made the
            -- choice between two snapshots of the same work order a coin
            -- toss, and a stale one could win forever. Four work orders
            -- reassigned in OnKey sat on the wrong technician for four days
            -- because of this line. When we last SAW a row is the only
            -- thing that means current.
            ORDER BY data->>'Code', last_seen_at DESC NULLS LAST,
                     start_date_ts DESC NULLS LAST
            ON CONFLICT (code) DO UPDATE SET
                status_code = EXCLUDED.status_code,
                status_description = EXCLUDED.status_description,
                status_changed_on = EXCLUDED.status_changed_on,
                staff_code = coalesce(EXCLUDED.staff_code, onkey_workorders.staff_code),
                site_number = coalesce(EXCLUDED.site_number, onkey_workorders.site_number),
                equipment_number = coalesce(EXCLUDED.equipment_number, onkey_workorders.equipment_number),
                received_on = coalesce(EXCLUDED.received_on, onkey_workorders.received_on),
                required_by = coalesce(EXCLUDED.required_by, onkey_workorders.required_by),
                complete_by = coalesce(EXCLUDED.complete_by, onkey_workorders.complete_by),
                completed_on = coalesce(EXCLUDED.completed_on, onkey_workorders.completed_on),
                contract_type = coalesce(EXCLUDED.contract_type, onkey_workorders.contract_type),
                work_required = coalesce(EXCLUDED.work_required, onkey_workorders.work_required),
                work_performed = coalesce(EXCLUDED.work_performed, onkey_workorders.work_performed),
                estimated_duration_minutes = coalesce(EXCLUDED.estimated_duration_minutes,
                                                      onkey_workorders.estimated_duration_minutes),
                updated_at = now()
            WHERE (onkey_workorders.status_code, onkey_workorders.status_description,
                   onkey_workorders.status_changed_on, onkey_workorders.staff_code,
                   onkey_workorders.site_number, onkey_workorders.equipment_number,
                   onkey_workorders.received_on, onkey_workorders.required_by,
                   onkey_workorders.complete_by, onkey_workorders.completed_on,
                   onkey_workorders.contract_type, onkey_workorders.work_required,
                   onkey_workorders.work_performed, onkey_workorders.estimated_duration_minutes)
                  IS DISTINCT FROM
                  (EXCLUDED.status_code, EXCLUDED.status_description,
                   EXCLUDED.status_changed_on,
                   coalesce(EXCLUDED.staff_code, onkey_workorders.staff_code),
                   coalesce(EXCLUDED.site_number, onkey_workorders.site_number),
                   coalesce(EXCLUDED.equipment_number, onkey_workorders.equipment_number),
                   coalesce(EXCLUDED.received_on, onkey_workorders.received_on),
                   coalesce(EXCLUDED.required_by, onkey_workorders.required_by),
                   coalesce(EXCLUDED.complete_by, onkey_workorders.complete_by),
                   coalesce(EXCLUDED.completed_on, onkey_workorders.completed_on),
                   coalesce(EXCLUDED.contract_type, onkey_workorders.contract_type),
                   coalesce(EXCLUDED.work_required, onkey_workorders.work_required),
                   coalesce(EXCLUDED.work_performed, onkey_workorders.work_performed),
                   coalesce(EXCLUDED.estimated_duration_minutes,
                            onkey_workorders.estimated_duration_minutes))
            """
        ),
        params,
    )
    # Master-data enrichment (#59): fill register blanks from the owner-loaded
    # master tables. Fill-blanks only, and never a manually-set field (#60).
    # Guarded (#172): only rows where a blank would actually be filled write.
    db.execute(
        text(
            """
            UPDATE onkey_sites s SET
                address = CASE WHEN s.manual_fields ? 'address' THEN s.address
                               ELSE coalesce(s.address, m.address) END,
                gps_location = CASE WHEN s.manual_fields ? 'gps_location' THEN s.gps_location
                                    ELSE coalesce(s.gps_location, m.gps_location) END,
                branch_code = coalesce(s.branch_code, m.branch),
                is_active = coalesce(m.is_active, s.is_active),
                updated_at = now()
            FROM (
                SELECT DISTINCT ON (location_code) location_code, address, gps_location, branch, is_active
                FROM onkey_location_master
                WHERE coalesce(location_code, '') <> ''
                ORDER BY location_code, is_active DESC NULLS LAST, code
            ) m
            WHERE m.location_code = s.site_number
              AND (s.address, s.gps_location, s.branch_code, s.is_active) IS DISTINCT FROM
                  (CASE WHEN s.manual_fields ? 'address' THEN s.address
                        ELSE coalesce(s.address, m.address) END,
                   CASE WHEN s.manual_fields ? 'gps_location' THEN s.gps_location
                        ELSE coalesce(s.gps_location, m.gps_location) END,
                   coalesce(s.branch_code, m.branch),
                   coalesce(m.is_active, s.is_active))
            """
        )
    )
    db.execute(
        text(
            r"""
            UPDATE onkey_equipment e SET
                description = coalesce(e.description, m.description),
                is_active = coalesce(m.is_active, e.is_active),
                site_number = coalesce(e.site_number, m.location_code),
                updated_at = now()
            FROM onkey_location_master m
            WHERE substring(m.code from '\((\d+)\)') = e.equipment_number
              AND (e.description, e.is_active, e.site_number) IS DISTINCT FROM
                  (coalesce(e.description, m.description),
                   coalesce(m.is_active, e.is_active),
                   coalesce(e.site_number, m.location_code))
            """
        )
    )
    db.execute(
        text(
            """
            UPDATE onkey_technicians t SET
                first_name = coalesce(t.first_name, m.first_name),
                last_name = coalesce(t.last_name, m.last_name),
                manager = coalesce(t.manager, m.manager),
                base_latitude = coalesce(t.base_latitude, m.latitude),
                base_longitude = coalesce(t.base_longitude, m.longitude),
                email = coalesce(t.email, m.email),
                updated_at = now()
            FROM onkey_technician_master m
            WHERE (lower(m.email) = lower(t.email)
               OR (t.email IS NULL AND lower(m.display_name) = lower(t.name)))
              AND (t.first_name, t.last_name, t.manager, t.base_latitude,
                   t.base_longitude, t.email) IS DISTINCT FROM
                  (coalesce(t.first_name, m.first_name),
                   coalesce(t.last_name, m.last_name),
                   coalesce(t.manager, m.manager),
                   coalesce(t.base_latitude, m.latitude),
                   coalesce(t.base_longitude, m.longitude),
                   coalesce(t.email, m.email))
            """
        )
    )
    # Allocation upkeep (#82): a technician whose manager name resolves,
    # via the master, to an email holding the manager role is allocated to
    # that manager. Additive only; removals stay an admin decision.
    db.execute(
        text(
            """
            INSERT INTO manager_technicians (manager_email, staff_code)
            SELECT mm.email, t.staff_code
            FROM onkey_technicians t
            JOIN onkey_technician_master mm
              ON lower(mm.display_name) = lower(t.manager)
            JOIN app_roles r ON r.email = mm.email AND r.role = 'manager'
            WHERE upper(t.staff_code) <> 'UNKNOWN'
            ON CONFLICT DO NOTHING
            """
        )
    )
    db.commit()

    # The eight full-table counts are diagnostics for the wide passes; a
    # two-minute cycle does not need them (#172).
    if row_hashes is not None:
        return {"windowed_rows": len(row_hashes)}

    counts = {}
    for table in ("onkey_technicians", "onkey_sites", "onkey_equipment", "onkey_workorders"):
        counts[table.removeprefix("onkey_")] = db.execute(
            text(f"SELECT count(*) FROM {table}")  # noqa: S608 — fixed table names
        ).scalar()
    counts["sites_with_gps"] = db.execute(
        text("SELECT count(*) FROM onkey_sites WHERE gps_location IS NOT NULL")
    ).scalar()
    counts["sites_with_oil_company"] = db.execute(
        text("SELECT count(*) FROM onkey_sites WHERE oil_company_name IS NOT NULL")
    ).scalar()
    counts["sites_with_address"] = db.execute(
        text("SELECT count(*) FROM onkey_sites WHERE address IS NOT NULL")
    ).scalar()
    counts["technicians_with_base"] = db.execute(
        text("SELECT count(*) FROM onkey_technicians WHERE base_latitude IS NOT NULL")
    ).scalar()
    return counts


DELTA_CURSOR_KEY = "woe_delta_cursor"
# How far the first delta run (no cursor yet) reaches back, and the
# overlap subtracted from the cursor on every fetch so clock skew between
# probe and export can never lose an edit. Duplicates cost nothing: the
# row hash makes a re-fetched unchanged row a no-op.
DELTA_FIRST_RUN_DAYS = 2
DELTA_OVERLAP = timedelta(seconds=60)


def _probe_watermark(probe: dict) -> datetime | None:
    """The later of the two probe timestamps, parsed on OnKey's clock."""
    stamps = []
    for key in ("WoLastModifiedOn", "QueueLastModifiedOn"):
        raw = probe.get(key)
        if not raw:
            continue
        try:
            stamps.append(datetime.fromisoformat(raw))
        except ValueError:
            continue
    return max(stamps) if stamps else None


def run_delta_sync(db: Session, settings: Settings) -> SyncSummary:
    """The probe-then-fetch lane (#180). Ask FIELDOPS - PROBE for the
    change watermark; only when it has moved past the stored cursor (or
    the total count changed) fetch FIELDOPS - WOE DELTA from the cursor
    and push it through the same hash-dedup pipeline as every other lane.
    All timestamps live on OnKey's clock, never ours: the cursor stores
    what the probe reported, and Since goes back out as that value minus
    a one-minute overlap."""
    stored = db.execute(
        text("SELECT value FROM onkey_config WHERE key = :k"), {"k": DELTA_CURSOR_KEY}
    ).scalar()
    prev_mark = None
    prev_total = None
    if isinstance(stored, dict):
        try:
            prev_mark = datetime.fromisoformat(stored.get("watermark", ""))
        except ValueError:
            prev_mark = None
        prev_total = stored.get("total")

    summary = SyncSummary(mode="delta", window_start="", window_end="")
    columns: set[str] = set()
    with OnKeySoapClient(settings) as client:
        probe = client.export_probe()
        mark = _probe_watermark(probe)
        total = int(probe["Total"]) if str(probe.get("Total", "")).isdigit() else None
        if mark is None:
            raise RuntimeError(f"probe returned no watermark: {probe!r}")
        unchanged = (
            prev_mark is not None
            and mark <= prev_mark
            and (total is None or total == prev_total)
        )
        summary.window_end = mark.isoformat()
        if unchanged:
            summary.window_start = prev_mark.isoformat()
            return summary

        since = (prev_mark or mark - timedelta(days=DELTA_FIRST_RUN_DAYS)) - DELTA_OVERLAP
        summary.window_start = since.isoformat()
        min_id = 0
        while True:
            rows = client.export_delta(since, min_id)
            chunk = {row_content_hash(r): r for r in rows}
            if chunk:
                inserted, refreshed = upsert_rows(db, chunk)
                summary.rows_fetched += len(chunk)
                summary.rows_inserted += inserted
                summary.rows_refreshed += refreshed
                for row in chunk.values():
                    columns.update(row.keys())
                # Same windowed derive as the recent lane (#172): the
                # delta window is the present by construction.
                summary.registers = derive_registers(db, list(chunk.keys()))
            if len(rows) < settings.onkey_max_records:
                break
            min_id = max(int(r["Id"]) for r in rows if str(r.get("Id", "")).isdigit()) + 1

    db.execute(
        text(
            "INSERT INTO onkey_config (key, value, updated_at) "
            "VALUES (:k, cast(:v as jsonb), now()) "
            "ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()"
        ),
        {"k": DELTA_CURSOR_KEY, "v": json.dumps({"watermark": mark.isoformat(), "total": total})},
    )
    # Arrival-driven derivation (#180): a change just landed, so the seed
    # and reconcile run NOW instead of waiting for their cron slots, which
    # stay only as the fallback heartbeat (migration 117).
    if summary.rows_inserted:
        db.execute(text("SELECT wo_seed_from_onkey_guarded()"))
        db.execute(text("SELECT wo_reconcile()"))
    db.commit()
    summary.columns = sorted(columns)
    return summary


def run_sync(db: Session, settings: Settings, mode: str) -> SyncSummary:
    """mode 'delta': the probe-then-fetch lane (#180), a one-row watermark
    check that only exports when something actually changed;
    mode 'recent': the fast lane, a narrow window (default 2 days), now
    the delta lane's shadow validator;
    mode 'incremental': the wide 35-day sweep, the safety net for changes
    the narrow window's date filter cannot see (a reassignment that moves
    WorkOrderLastModifiedOn but not the queue transition time);
    mode 'backfill': everything since ONKEY_BACKFILL_START;
    mode 'derive': no export at all, just rebuild the registers from rows
    already in onkey_woe001."""
    if mode == "delta":
        return run_delta_sync(db, settings)
    end = datetime.now().replace(hour=23, minute=59, second=59, microsecond=0)
    if mode == "derive":
        # The registers are a pure function of the raw snapshot table, so
        # they can always be rebuilt without touching OnKey. Needed
        # because export runs long enough to outlive a client timeout,
        # which leaves raw rows landed and the registers stale.
        summary = SyncSummary(mode=mode, window_start="", window_end="")
        summary.registers = derive_registers(db)
        return summary
    if mode == "backfill":
        start = datetime.fromisoformat(settings.onkey_backfill_start)
    elif mode == "incremental":
        start = (end - timedelta(days=settings.onkey_sync_window_days)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    elif mode == "recent":
        start = (end - timedelta(days=settings.onkey_recent_window_days)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
    else:
        raise ValueError("mode must be 'recent', 'incremental' or 'backfill'")

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
            # Derive after EVERY chunk, not once at the end. Chunks run
            # newest-first, so the current window reaches the registers
            # within the first one and the work list is current even if
            # the run is cut short. Deriving only at the end meant a run
            # that outlived its caller landed raw rows and left the
            # registers untouched: the export looked fine and the app
            # stayed stale. Idempotent upserts, so repeating is free.
            #
            # The recent lane derives from exactly the rows it fetched
            # (#172): its window is the present, so windowing is safe
            # there and only there; see derive_registers.
            summary.registers = derive_registers(
                db, list(chunk.keys()) if mode == "recent" else None
            )
    summary.columns = sorted(columns)
    if not summary.registers and mode != "recent":
        # An empty recent fetch changed nothing, so there is nothing to
        # derive (#172); the wide passes keep their final full derive.
        summary.registers = derive_registers(db)
    return summary
