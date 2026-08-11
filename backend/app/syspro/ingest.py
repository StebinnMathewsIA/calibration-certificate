"""Load the Syspro catalogue into `syspro_stock` (#136).

Three constraints shape this and none of them is a preference.

**No ORDER BY.** The first attempt paged by keyset, which needs a sort,
and the very first page never returned: eight minutes without emitting a
row. Ordering the InvWarehouse/InvMaster join makes a 2008 R2 server
materialise and sort the whole thing before it can answer. The same data
unordered streams immediately, because rows can be emitted as they are
found. So this streams and does not page.

**No WHERE either, and this one is counter-intuitive.** Filtering to the
85 van warehouses server-side, which should have been less work, was
about fifty times SLOWER: 5,000 rows in five minutes against 20,000 in
seven seconds unfiltered. The index on InvWarehouse does not lead with
Warehouse, so the filter buys no seek, and the plan it produces stops the
server streaming. What this server is fast at is scanning and emitting.
So we ask for everything and drop the non-van rows here, where a string
comparison costs nothing.

**Bounded memory.** The backend has 512 MB and already overruns it
(#134). Batches are written and released as they arrive, so the load
never holds the catalogue.
"""
from __future__ import annotations

import threading
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings
from .client import SysproClient, SysproError, qualify

# Rows held at once. Small enough that the working set stays trivial,
# large enough that the round trips to Postgres are not the bottleneck.
BATCH_SIZE = 5000
# A stop, not a target. If the van warehouses ever return more rows than
# this, the shape of the data has changed and somebody should look rather
# than let a loop run against Prowalco's server.
MAX_ROWS = 2_000_000


def q_all_stock(database: str) -> str:
    """The whole catalogue, unordered and unfiltered.

    Both absences are deliberate and both were measured. An ORDER BY makes
    the server sort the entire join before answering and it never returns.
    A WHERE on Warehouse produces a plan that stops it streaming and runs
    roughly fifty times slower than no filter at all. What is left is the
    thing this server does well: scan and emit."""
    db = qualify(database)
    return f"""
SELECT '{db}'         AS company,
       w.StockCode    AS stock_code,
       w.Warehouse    AS warehouse,
       m.Description  AS description,
       m.StockUom     AS unit,
       w.QtyOnHand    AS qty_on_hand,
       w.UnitCost     AS unit_cost
FROM {db}.dbo.InvWarehouse w
LEFT JOIN {db}.dbo.InvMaster m ON m.StockCode = w.StockCode
"""


def _num(value: Any) -> Decimal | None:
    """TDS 7.0 hands numerics back as strings ('18.000000'), so every
    quantity and cost arrives needing a cast. Returns None on a value that
    will not convert; the caller rejects that row rather than storing a
    zero, because a zero here reads as "none left on the van"."""
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    try:
        return Decimal(str(value).strip())
    except (InvalidOperation, ValueError):
        return None


_COLUMNS = (
    "company",
    "stock_code",
    "warehouse",
    "description",
    "unit",
    "quantity_on_hand",
    "unit_cost",
)
# Rows per INSERT statement. 1,000 rows x 7 columns is 7,000 bound
# parameters, comfortably inside Postgres's 65,535 limit.
_WRITE_CHUNK = 1000


def _upsert_many(db: Session, rows: list[dict]) -> int:
    """One multi-row INSERT per chunk, rather than one statement per row.

    This is the difference between a load that finishes and one that does
    not. Handing SQLAlchemy a list and letting executemany deal with it
    issues a separate statement per row, and against a Supabase instance
    across the network that is a round trip per row: the first attempt
    managed roughly eighty rows a minute. Syspro was never the slow part.

    Rows are deduplicated on the conflict key first, because a single
    statement cannot touch the same row twice: Postgres rejects the whole
    batch with "cannot affect row a second time"."""
    unique: dict[tuple, dict] = {}
    for row in rows:
        unique[(row["company"], row["stock_code"], row["warehouse"])] = row
    batch = list(unique.values())

    written = 0
    for start in range(0, len(batch), _WRITE_CHUNK):
        part = batch[start : start + _WRITE_CHUNK]
        tuples = ", ".join(
            "(" + ", ".join(f":{column}_{index}" for column in _COLUMNS) + ", now())"
            for index in range(len(part))
        )
        params: dict[str, Any] = {}
        for index, row in enumerate(part):
            for column in _COLUMNS:
                params[f"{column}_{index}"] = row[column]
        db.execute(
            text(
                f"""
                INSERT INTO syspro_stock
                    (company, stock_code, warehouse, description, unit,
                     quantity_on_hand, unit_cost, last_seen_at)
                VALUES {tuples}
                ON CONFLICT (company, stock_code, warehouse) DO UPDATE
                   SET description = excluded.description,
                       unit = excluded.unit,
                       quantity_on_hand = excluded.quantity_on_hand,
                       unit_cost = excluded.unit_cost,
                       last_seen_at = now()
                """
            ),
            params,
        )
        written += len(part)
    return written


def load_stock(db: Session, settings: Settings) -> dict:
    """Full load: one streaming query over the van warehouses."""
    database = qualify(settings.syspro_database)
    client = SysproClient(settings)

    # A load whose process was restarted mid-flight leaves a row saying
    # 'running' for ever, and the next reader cannot tell that from a load
    # that really is in flight. The in-process lock died with the process;
    # this cleans up what it left behind.
    db.execute(
        text(
            """
            UPDATE syspro_loads
               SET state = 'abandoned', finished_at = now(),
                   error = 'the process restarted while this load was running'
             WHERE state = 'running'
            """
        )
    )
    load_id = db.execute(
        text("INSERT INTO syspro_loads (state) VALUES ('running') RETURNING id")
    ).scalar()
    db.commit()

    warehouses = [
        row[0]
        for row in db.execute(
            text(
                """
                SELECT DISTINCT warehouse_code
                  FROM technician_warehouses
                 WHERE status = 'verified' AND warehouse_code IS NOT NULL
                 ORDER BY warehouse_code
                """
            )
        ).all()
    ]
    if not warehouses:
        raise SysproError("no verified van warehouses to load")

    wanted = set(warehouses)
    seen = written = rejected = skipped = batches = 0
    complete = False

    try:
        sql = q_all_stock(database)
        for chunk in client.stream(sql, batch_size=BATCH_SIZE):
            batches += 1
            batch: list[dict] = []
            for row in chunk:
                seen += 1
                if (row.get("warehouse") or "").strip() not in wanted:
                    # Branch stores, bins and the rest of Syspro's 158
                    # warehouses. Discarded here rather than in the query,
                    # because asking the server to filter costs fifty
                    # times more than reading and dropping the row.
                    skipped += 1
                    continue
                quantity = _num(row.get("qty_on_hand"))
                if quantity is None:
                    # Refused, not defaulted. A zero here would read as an
                    # empty van, which is a different and worse lie than a
                    # missing row.
                    rejected += 1
                    continue
                code = (row.get("stock_code") or "").strip()
                warehouse = (row.get("warehouse") or "").strip()
                if not code or not warehouse:
                    rejected += 1
                    continue
                batch.append(
                    {
                        "company": row.get("company") or database,
                        "stock_code": code[:64],
                        "warehouse": warehouse[:16],
                        "description": (row.get("description") or "").strip() or None,
                        "unit": ((row.get("unit") or "").strip() or None),
                        "quantity_on_hand": quantity,
                        "unit_cost": _num(row.get("unit_cost")),
                    }
                )

            if batch:
                written += _upsert_many(db, batch)
                db.commit()

            if seen > MAX_ROWS:
                raise SysproError(
                    f"stopped after {seen} rows, more than expected for {len(warehouses)} vans"
                )
        complete = True

        summary = db.execute(
            text(
                """
                SELECT count(*)::int AS rows,
                       count(DISTINCT warehouse)::int AS warehouses,
                       count(DISTINCT stock_code)::int AS stock_codes
                  FROM syspro_stock
                """
            )
        ).mappings().one()

        derived = 0
        if complete:
            # Rows Syspro no longer returns are gone. Two guards on this.
            # Only after a COMPLETE load, because pruning a partial one
            # deletes stock that had simply not arrived yet. And only for
            # the warehouses this load actually covered, so a van that is
            # not in the list keeps its rows instead of being silently
            # emptied by a load that never asked about it.
            db.execute(
                text(
                    """
                    DELETE FROM syspro_stock
                     WHERE company = :company
                       AND warehouse = ANY(:warehouses)
                       AND last_seen_at < (SELECT started_at FROM syspro_loads WHERE id = :id)
                    """
                ),
                {"company": database, "warehouses": warehouses, "id": load_id},
            )
            derived = db.execute(text("SELECT syspro_derive_stock_items()")).scalar() or 0
            db.commit()

        db.execute(
            text(
                """
                UPDATE syspro_loads
                   SET finished_at = now(),
                       state = :state,
                       rows_seen = :seen, rows_written = :written,
                       rows_rejected = :rejected, warehouses = :warehouses,
                       stock_codes = :codes, pages = :pages
                 WHERE id = :id
                """
            ),
            {
                "state": "succeeded" if complete else "partial",
                "seen": seen,
                "written": written,
                "rejected": rejected,
                "warehouses": summary["warehouses"],
                "codes": summary["stock_codes"],
                "pages": batches,
                "id": load_id,
            },
        )
        db.commit()

        return {
            "loadId": load_id,
            "state": "succeeded" if complete else "partial",
            "pages": batches,
            "rowsSeen": seen,
            "rowsWritten": written,
            "rowsRejected": rejected,
            "rowsSkippedNotAVan": skipped,
            "storedRows": summary["rows"],
            "warehouses": summary["warehouses"],
            "stockCodes": summary["stock_codes"],
            "stockItemsDerived": derived,
        }
    except Exception as exc:
        db.rollback()
        db.execute(
            text(
                """
                UPDATE syspro_loads
                   SET finished_at = now(), state = 'failed', error = :error,
                       rows_seen = :seen, rows_written = :written, pages = :pages
                 WHERE id = :id
                """
            ),
            {
                "error": str(exc)[:2000],
                "seen": seen,
                "written": written,
                "pages": batches,
                "id": load_id,
            },
        )
        db.commit()
        raise


# Single-flight. Two concurrent loads would fight over the same keyset and
# double the memory on an instance that already overruns (#134).
_lock = threading.Lock()
_state: dict = {"running": False, "last": None}


def load_state() -> dict:
    return dict(_state)


def run_load(db: Session, settings: Settings) -> dict:
    with _lock:
        if _state["running"]:
            return {"accepted": False, "reason": "a load is already running"}
        _state["running"] = True
    try:
        result = load_stock(db, settings)
        _state["last"] = result
        return {"accepted": True, **result}
    finally:
        _state["running"] = False
