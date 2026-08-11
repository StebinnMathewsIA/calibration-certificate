"""Load the Syspro catalogue into `syspro_stock` (#136).

Three constraints shape this and none of them is a preference.

**No ORDER BY.** The first attempt paged by keyset, which needs a sort,
and the very first page never returned: eight minutes without emitting a
row. Ordering the InvWarehouse/InvMaster join makes a 2008 R2 server
materialise and sort the whole thing before it can answer. The same data
unordered streams immediately, because rows can be emitted as they are
found. So this streams and does not page.

**Only the warehouses we need.** Syspro has 158 warehouses: branch
stores, bins and vans together. We care about vans, and pulling only
those cuts the volume by more than half and is better manners toward
somebody else's production database. The list comes from
`technician_warehouses`, which is also exactly the set #137 and #138 ask
about.

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


def q_warehouse_stock(database: str, warehouse_count: int) -> str:
    """Every stock row for a given set of warehouses.

    NO ORDER BY, deliberately. See the module docstring: sorting this join
    on a 2008 R2 server does not return, and nothing downstream needs the
    rows in order, since they go into a table with its own indexes."""
    db = qualify(database)
    count = int(warehouse_count)
    if not 1 <= count <= 500:
        raise SysproError(f"warehouse count {count} is out of range")
    placeholders = ", ".join(["%s"] * count)
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
WHERE w.Warehouse IN ({placeholders})
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


_UPSERT = text(
    """
    INSERT INTO syspro_stock
        (company, stock_code, warehouse, description, unit,
         quantity_on_hand, unit_cost, last_seen_at)
    VALUES
        (:company, :stock_code, :warehouse, :description, :unit,
         :quantity_on_hand, :unit_cost, now())
    ON CONFLICT (company, stock_code, warehouse) DO UPDATE
       SET description = excluded.description,
           unit = excluded.unit,
           quantity_on_hand = excluded.quantity_on_hand,
           unit_cost = excluded.unit_cost,
           last_seen_at = now()
    """
)


def load_stock(db: Session, settings: Settings) -> dict:
    """Full load: one streaming query over the van warehouses."""
    database = qualify(settings.syspro_database)
    client = SysproClient(settings)

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

    seen = written = rejected = batches = 0
    complete = False

    try:
        sql = q_warehouse_stock(database, len(warehouses))
        for chunk in client.stream(sql, params=warehouses, batch_size=BATCH_SIZE):
            batches += 1
            batch: list[dict] = []
            for row in chunk:
                seen += 1
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
                db.execute(_UPSERT, batch)
                db.commit()
                written += len(batch)

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
