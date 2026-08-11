-- Syspro stock at its real grain: one row per stock code per warehouse (#136).
--
-- WHY NOT stock_items. That register is aggregated, one row per item, and
-- migration 059 is explicit that its quantity is "a RELEVANCE signal, not a
-- stock figure to rely on". Correct for a global picker, useless for the
-- question everything now asks: what is on THIS van. The per-warehouse
-- detail was thrown away at load time, so it has to be landed properly.
--
-- THE JOIN WORKS. The spec carried a finding that Syspro and OnKey could
-- not be joined on warehouse code, from a 20-row sample that turned out to
-- be mostly branch stores. Tested against the live catalogue on 2026-08-11:
-- all 85 of our van warehouse codes exist in Syspro, 85 of 85.
--
-- stock_items is now DERIVED from this table rather than loaded separately,
-- so the two cannot drift apart and disagree about what a van carries.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS syspro_stock (
    -- Prowalco runs SysproCompanyRSA and, for Lesotho, SysproCompanyH. We
    -- pull RSA only, but a row that cannot say which company it came from
    -- is one that cannot take the second later without guesswork.
    company varchar(64) NOT NULL,
    stock_code varchar(64) NOT NULL,
    warehouse varchar(16) NOT NULL,
    description text,
    unit varchar(16),
    /** Stored as numeric even though the wire delivers strings. The Syspro
     * endpoint only speaks TDS 7.0 (#135), which hands back '18.000000'
     * rather than a number; the loader casts, and refuses a row it cannot
     * cast rather than quietly writing a zero that reads as "none left". */
    quantity_on_hand numeric(18, 6) NOT NULL DEFAULT 0,
    unit_cost numeric(18, 6),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (company, stock_code, warehouse)
);

-- The per-van lookup is the hot path for the picker and the stock tab.
CREATE INDEX IF NOT EXISTS syspro_stock_warehouse_idx
    ON syspro_stock (warehouse, stock_code);
CREATE INDEX IF NOT EXISTS syspro_stock_code_idx
    ON syspro_stock (stock_code);
-- In-stock-first ordering, which both the picker and the tab use.
CREATE INDEX IF NOT EXISTS syspro_stock_warehouse_qty_idx
    ON syspro_stock (warehouse, (quantity_on_hand > 0) DESC, stock_code);

ALTER TABLE syspro_stock ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON syspro_stock FROM anon, authenticated;

/** When the pull last ran, and how it went. The stock tab shows this: a
 * quantity with no timestamp invites someone to treat a snapshot of
 * somebody else's system as live and drive to a depot on it. */
CREATE TABLE IF NOT EXISTS syspro_loads (
    id bigserial PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    state varchar(16) NOT NULL DEFAULT 'running',
    rows_seen int NOT NULL DEFAULT 0,
    rows_written int NOT NULL DEFAULT 0,
    rows_rejected int NOT NULL DEFAULT 0,
    warehouses int NOT NULL DEFAULT 0,
    stock_codes int NOT NULL DEFAULT 0,
    pages int NOT NULL DEFAULT 0,
    error text
);
ALTER TABLE syspro_loads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON syspro_loads FROM anon, authenticated;

/** Rebuild stock_items from syspro_stock.
 *
 * van_count finally means what migration 059 said it meant. It counted
 * every warehouse holding the item, and Syspro has 158 of them: branch
 * stores, bins and the vans all together. Counting only warehouses that
 * are actually somebody's van stops a part sitting in two depots from
 * out-ranking a part on thirty vans.
 *
 * OnKey-sourced rows are left in place. Syspro wins a collision because it
 * is the stock master, but the OnKey register stays as the fallback if the
 * connection is ever pulled. */
CREATE OR REPLACE FUNCTION syspro_derive_stock_items()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_rows int;
BEGIN
    WITH vans AS (
        SELECT DISTINCT warehouse_code
          FROM technician_warehouses
         WHERE status = 'verified' AND warehouse_code IS NOT NULL
    ),
    rolled AS (
        SELECT s.stock_code,
               max(s.description) AS description,
               coalesce(max(s.unit), 'EA') AS unit,
               count(*) FILTER (
                   WHERE s.quantity_on_hand > 0
                     AND s.warehouse IN (SELECT warehouse_code FROM vans)
               )::int AS van_count,
               sum(s.quantity_on_hand) FILTER (
                   WHERE s.warehouse IN (SELECT warehouse_code FROM vans)
               ) AS on_vans
          FROM syspro_stock s
         GROUP BY s.stock_code
    )
    INSERT INTO stock_items AS t
        (item_code, description, unit, source, is_active, van_count, quantity_on_hand, updated_at)
    SELECT r.stock_code,
           r.description,
           left(r.unit, 16),
           'syspro',
           true,
           r.van_count,
           round(coalesce(r.on_vans, 0), 3),
           now()
      FROM rolled r
    ON CONFLICT (item_code) DO UPDATE
       SET description = excluded.description,
           unit = excluded.unit,
           source = 'syspro',
           is_active = true,
           van_count = excluded.van_count,
           quantity_on_hand = excluded.quantity_on_hand,
           updated_at = now();

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    RETURN v_rows;
END;
$function$;

/** Last successful load, for the freshness line on the stock tab. */
CREATE OR REPLACE FUNCTION syspro_last_load()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT max(finished_at) FROM syspro_loads WHERE state = 'succeeded';
$function$;
