-- Fix app_stock_search: description and unit were not aggregated (#137).
--
-- The scoped picker groups by stock_code, because one item can sit in
-- several of a manager's vans and the picker wants one row per part. The
-- select list still named s.description and s.unit directly, so Postgres
-- refused the whole query:
--
--   column "s.description" must appear in the GROUP BY clause
--
-- It threw for EVERY caller with a real van. The unscoped branch, which
-- reads stock_items and does not group, was fine, which is why the earlier
-- tests passed: they exercised the branch that no technician takes.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION app_stock_search(p_query text, p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_scope jsonb := app_stock_scope();
    v_mode text := v_scope ->> 'mode';
    v_warehouses text[];
    v_limit int := greatest(1, least(coalesce(p_limit, 200), 500));
    v_q text := coalesce(trim(p_query), '');
    v_items jsonb;
BEGIN
    SELECT array_agg(value::text) INTO v_warehouses
      FROM jsonb_array_elements_text(v_scope -> 'warehouses') AS value;

    IF v_mode IN ('van', 'team', 'all') AND v_warehouses IS NOT NULL
       AND cardinality(v_warehouses) > 0 THEN
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'itemCode', item_code,
                   'description', description,
                   'unit', unit,
                   'quantity', quantity,
                   'inStock', quantity > 0,
                   'vanCount', van_count)
                   ORDER BY rank, (quantity > 0) DESC, quantity DESC, item_code), '[]'::jsonb)
          INTO v_items
          FROM (
            SELECT s.stock_code AS item_code,
                   -- Aggregated, not named bare. Description and unit are
                   -- the same across a van's rows for one stock code, so
                   -- max() picks the only value there is.
                   max(s.description) AS description,
                   coalesce(max(s.unit), 'EA') AS unit,
                   round(sum(s.quantity_on_hand), 3) AS quantity,
                   count(DISTINCT s.warehouse)::int AS van_count,
                   min(CASE
                       WHEN v_q = '' THEN 0
                       WHEN s.stock_code ILIKE v_q || '%' THEN 0
                       WHEN s.stock_code ILIKE '%' || v_q || '%' THEN 1
                       ELSE 2
                   END) AS rank
              FROM syspro_stock s
             WHERE s.warehouse = ANY (v_warehouses)
               AND NOT EXISTS (
                     SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.stock_code)
               AND (v_q = ''
                    OR s.stock_code ILIKE '%' || v_q || '%'
                    OR s.description ILIKE '%' || v_q || '%')
             GROUP BY s.stock_code
             ORDER BY rank, (sum(s.quantity_on_hand) > 0) DESC,
                      sum(s.quantity_on_hand) DESC, s.stock_code
             LIMIT v_limit
          ) hits;
    ELSE
        -- no_van and unverified: the whole register, for reference. A
        -- no_van technician cannot book a spare anyway (migration 082),
        -- so an unrestricted list costs nothing and an empty one would
        -- just look broken.
        SELECT coalesce(jsonb_agg(jsonb_build_object(
                   'itemCode', item_code,
                   'description', description,
                   'unit', unit,
                   'quantity', NULL,
                   'inStock', NULL,
                   'vanCount', van_count) ORDER BY rank, van_count DESC, item_code), '[]'::jsonb)
          INTO v_items
          FROM (
            SELECT s.item_code, s.description, s.unit, s.van_count,
                   CASE
                       WHEN v_q = '' THEN 0
                       WHEN s.item_code ILIKE v_q || '%' THEN 0
                       WHEN s.item_code ILIKE '%' || v_q || '%' THEN 1
                       ELSE 2
                   END AS rank
              FROM stock_items s
             WHERE s.is_active
               AND NOT EXISTS (
                     SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.item_code)
               AND (v_q = ''
                    OR s.item_code ILIKE '%' || v_q || '%'
                    OR s.description ILIKE '%' || v_q || '%')
             ORDER BY rank, s.van_count DESC, s.item_code
             LIMIT v_limit
          ) hits;
    END IF;

    RETURN v_items;
END;
$function$;

GRANT EXECUTE ON FUNCTION app_stock_search(text, int) TO authenticated;
