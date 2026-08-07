-- Stock item register and search (#105), so parts on a job card are PICKED
-- rather than typed. A technician typing "NOZ-11B" from memory at a
-- forecourt produces codes that do not exist, and a costing line with an
-- unknown item code is rejected by OnKey after the client has already
-- signed.
--
-- SOURCE. Populated today from FIELDOPS - INV, which is per-warehouse stock
-- and whose warehouses ARE the vans ("VAN - RSAJHB - T. PITSI"), so this is
-- genuinely what the technicians carry. Syspro is being wired next week and
-- becomes another source: the `source` column and the refresh-per-source
-- pattern mean that arrives as a second loader, with no change to the RPC
-- or to the app.
--
-- WHAT IS DELIBERATELY EXCLUDED. Travel, vehicle and the three labour rates
-- live in the same OnKey stock master, and they already have their own
-- fields on the job card. Offering them in the parts picker as well would
-- let a technician book labour twice and neither entry would look wrong.
-- They are filtered out here, once, rather than in the UI.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS stock_items (
    item_code varchar(64) PRIMARY KEY,
    description text,
    unit varchar(16) NOT NULL DEFAULT 'EA',
    -- 'onkey' from the inventory export, 'syspro' when that feed lands,
    -- 'manual' for anything typed in by hand and kept.
    source varchar(16) NOT NULL DEFAULT 'onkey',
    is_active boolean NOT NULL DEFAULT true,
    /** How many warehouses (vans) hold it, and the total on hand. Not a
     * stock figure to rely on, a RELEVANCE signal: the thing three vans
     * carry should be found before the thing none do. */
    van_count int NOT NULL DEFAULT 0,
    quantity_on_hand numeric(14, 3) NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_items_desc_idx
    ON stock_items USING gin (to_tsvector('simple', coalesce(description, '')));

ALTER TABLE stock_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_items FROM anon, authenticated;

/** Codes the picker must never offer, because the job card books them
 * through their own fields. Kept as a table, not a literal, so adding a
 * Sunday labour rate is a row rather than a migration. */
CREATE TABLE IF NOT EXISTS stock_item_exclusions (
    item_code varchar(64) PRIMARY KEY,
    reason text
);
ALTER TABLE stock_item_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON stock_item_exclusions FROM anon, authenticated;

INSERT INTO stock_item_exclusions (item_code, reason)
SELECT item_code, 'booked through its own field on the job card'
  FROM onkey_charge_items
ON CONFLICT (item_code) DO NOTHING;

/** Rebuild the register from the OnKey inventory export. Aggregated across
 * warehouses: one row per item, not one per van. */
CREATE OR REPLACE FUNCTION stock_items_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    touched int;
BEGIN
    WITH src AS (
        SELECT DISTINCT ON (r.data ->> 'StockItemCode', r.data ->> 'WarehouseCode')
               r.data ->> 'StockItemCode' AS item_code,
               r.data ->> 'StockItemDescription' AS description,
               coalesce(nullif(r.data ->> 'StockItemUnitCode', ''), 'EA') AS unit,
               (r.data ->> 'StockItemIsActive') = 'true' AS is_active,
               r.data ->> 'WarehouseCode' AS warehouse_code,
               coalesce((r.data ->> 'QuantityOnHand')::numeric, 0) AS qty
          FROM onkey_report_rows r
         WHERE r.report_code = 'FIELDOPS - INV'
           AND coalesce(r.data ->> 'StockItemCode', '') <> ''
         ORDER BY r.data ->> 'StockItemCode', r.data ->> 'WarehouseCode', r.last_seen_at DESC
    ),
    rolled AS (
        SELECT item_code,
               max(description) AS description,
               max(unit) AS unit,
               bool_or(is_active) AS is_active,
               count(DISTINCT warehouse_code) FILTER (WHERE qty > 0) AS van_count,
               sum(qty) AS quantity_on_hand
          FROM src
         GROUP BY item_code
    )
    INSERT INTO stock_items (
        item_code, description, unit, source, is_active, van_count,
        quantity_on_hand, updated_at)
    SELECT item_code, description, unit, 'onkey', is_active, van_count,
           quantity_on_hand, now()
      FROM rolled
    ON CONFLICT (item_code) DO UPDATE SET
        description = EXCLUDED.description,
        unit = EXCLUDED.unit,
        is_active = EXCLUDED.is_active,
        van_count = EXCLUDED.van_count,
        quantity_on_hand = EXCLUDED.quantity_on_hand,
        updated_at = now()
    -- Syspro wins once it lands: an OnKey refresh must not overwrite a
    -- record a better source already owns.
    WHERE stock_items.source <> 'syspro';

    GET DIAGNOSTICS touched = ROW_COUNT;
    RETURN jsonb_build_object('refreshed', touched);
END $function$;

/** Search the register. Code match first (a technician reading a part off
 * a box types the code), then description. Ordered by whether the vans
 * actually carry it, because the thing three vans hold is more likely the
 * thing in this technician's hand than a catalogue entry nobody stocks. */
CREATE OR REPLACE FUNCTION app_stock_search(p_query text, p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'itemCode', item_code,
               'description', description,
               'unit', unit,
               'vanCount', van_count) ORDER BY rank, van_count DESC, item_code), '[]'::jsonb)
      FROM (
        SELECT s.item_code, s.description, s.unit, s.van_count,
               CASE
                   WHEN s.item_code ILIKE coalesce(p_query, '') || '%' THEN 0
                   WHEN s.item_code ILIKE '%' || coalesce(p_query, '') || '%' THEN 1
                   ELSE 2
               END AS rank
          FROM stock_items s
         WHERE s.is_active
           AND NOT EXISTS (
                 SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.item_code)
           AND coalesce(trim(p_query), '') <> ''
           AND (s.item_code ILIKE '%' || p_query || '%'
                OR s.description ILIKE '%' || p_query || '%')
         LIMIT greatest(1, least(coalesce(p_limit, 25), 50))
      ) hits;
$function$;

GRANT EXECUTE ON FUNCTION app_stock_search(text, int) TO authenticated;
REVOKE ALL ON FUNCTION stock_items_refresh() FROM anon, authenticated;

SELECT stock_items_refresh();
