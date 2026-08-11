"""Load the Syspro catalogue into `syspro_stock` (#136).

Two constraints shape this and neither is a preference.

The server is SQL Server 2008 R2, so `OFFSET ... FETCH` does not exist:
it arrived in 2012. Paging is keyset on (StockCode, Warehouse), which is
also the right choice anyway, since OFFSET on a large join re-scans the
whole thing every page and this runs against someone else's production
box.

The backend has 512 MB and already overruns it (#134). Each page is
written and released before the next is fetched, so the load never holds
the catalogue in memory. Accumulating pages and writing once at the end
would be simpler and would restart the API.
"""
from __future__ import annotations

import threading
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings
from .client import SysproClient, SysproError, qualify

# One page. Measured: 20,000 rows crossed the wire in 7 seconds, so this is
# comfortably inside any timeout while keeping the working set small.
PAGE_SIZE = 20000
# A stop, not a target. A catalogue that needs more pages than this has
# changed shape and someone should look rather than let a loop run.
MAX_PAGES = 200


def q_catalogue_page(
    database: str,
    page_size: int = PAGE_SIZE,
    after_code: str | None = None,
    after_warehouse: str | None = None,
) -> str:
    """One keyset page, ordered by (StockCode, Warehouse).

    `page_size` is interpolated because TOP takes a literal here and the
    value is ours, not a caller's; it is bounds-checked regardless. The
    keyset values are data and are passed as parameters."""
    db = qualify(database)
    size = int(page_size)
    if not 1 <= size <= 50000:
        raise SysproError(f"page size {size} is out of range")
    where = "WHERE w.QtyOnHand IS NOT NULL"
    if after_code is not None:
        where += " AND (w.StockCode > %s OR (w.StockCode = %s AND w.Warehouse > %s))"
    return f"""
SELECT TOP ({size})
       '{db}'         AS company,
       w.StockCode    AS stock_code,
       w.Warehouse    AS warehouse,
       m.Description  AS description,
       m.StockUom     AS unit,
       w.QtyOnHand    AS qty_on_hand,
       w.UnitCost     AS unit_cost
FROM {db}.dbo.InvWarehouse w
LEFT JOIN {db}.dbo.InvMaster m ON m.StockCode = w.StockCode
{where}
ORDER BY w.StockCode, w.Warehouse
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
    """Full load, page by page. Returns the load record."""
    database = qualify(settings.syspro_database)
    client = SysproClient(settings)

    load_id = db.execute(
        text("INSERT INTO syspro_loads (state) VALUES ('running') RETURNING id")
    ).scalar()
    db.commit()

    seen = written = rejected = pages = 0
    after_code: str | None = None
    after_warehouse: str | None = None
    complete = False

    try:
        while pages < MAX_PAGES:
            sql = q_catalogue_page(database, PAGE_SIZE, after_code, after_warehouse)
            params = (
                None
                if after_code is None
                else (after_code, after_code, after_warehouse)
            )
            rows = client.rows(sql, params=params)
            pages += 1
            if not rows:
                complete = True
                break

            batch: list[dict] = []
            for row in rows:
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

            # Keyset advances on the RAW last row, not the last accepted
            # one. Advancing on an accepted row would re-read a rejected
            # row for ever, or skip past it, depending on which side of
            # the boundary it fell.
            last = rows[-1]
            after_code = (last.get("stock_code") or "").strip()
            after_warehouse = (last.get("warehouse") or "").strip()

            if len(rows) < PAGE_SIZE:
                complete = True
                break

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
            # Rows Syspro no longer returns are gone. Only safe on a
            # COMPLETE load: pruning after a partial one would delete
            # stock that simply had not been reached yet.
            db.execute(
                text(
                    """
                    DELETE FROM syspro_stock
                     WHERE company = :company
                       AND last_seen_at < (SELECT started_at FROM syspro_loads WHERE id = :id)
                    """
                ),
                {"company": database, "id": load_id},
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
                "pages": pages,
                "id": load_id,
            },
        )
        db.commit()

        return {
            "loadId": load_id,
            "state": "succeeded" if complete else "partial",
            "pages": pages,
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
                "pages": pages,
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
