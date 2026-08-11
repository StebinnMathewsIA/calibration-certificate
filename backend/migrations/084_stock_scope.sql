-- Scope the parts picker to the caller's own stock (#137).
--
-- The picker offered every item to everyone. A technician scrolling parts
-- that sit on somebody else's van in another province is picking from a
-- catalogue, not from their stock, and the pick is a guess. The register
-- exists so a costing line names a part that is really there.
--
-- QUANTITY ORDERS THE LIST, IT DOES NOT FILTER IT. Every row on the van is
-- offered, in-stock first, with the number shown. Hiding items at zero
-- would look identical to an empty van, and Syspro trails reality: a
-- technician who has just fitted a part they are holding must still be
-- able to book it. Showing the number lets them judge. Hiding the row
-- decides for them, wrongly.
--
-- Idempotent.

/** The warehouses a caller may pick from, and why.
 *
 * Five outcomes, because they are five different situations and only one
 * of them is a fault:
 *
 *   van          a verified technician, their own van
 *   team         a manager, the union of their technicians' vans
 *   all          an admin, everything
 *   no_van       confirmed as holding no stock. NOT a fault (#131)
 *   unverified   we do not know their van, and somebody should look
 *
 * A manager is matched to their reports by NAME, because
 * onkey_technicians.manager holds a name rather than a staff code or an
 * email. That is fragile and it is what OnKey gives us. Twenty-one
 * technicians have no manager set at all, so they belong to nobody and
 * appear only for admins; a manager's list is never silently short
 * without the scope saying so. */
CREATE OR REPLACE FUNCTION app_stock_scope()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_email text := app_email();
    v_role text := app_role();
    v_staff text := app_staff_code();
    v_status text;
    v_van text;
    v_van_name text;
    v_name text;
    v_warehouses text[];
    v_mode text;
    v_reason text;
BEGIN
    IF v_email = '' THEN
        RETURN jsonb_build_object('mode', 'unverified', 'warehouses', '[]'::jsonb,
                                  'reason', 'not signed in');
    END IF;

    SELECT w.status, w.warehouse_code, w.warehouse_description
      INTO v_status, v_van, v_van_name
      FROM technician_warehouses w
     WHERE w.staff_code = v_staff;

    IF v_role = 'admin' THEN
        v_mode := 'all';
        v_reason := 'administrator, every van';
        SELECT array_agg(DISTINCT warehouse_code) INTO v_warehouses
          FROM technician_warehouses
         WHERE status = 'verified' AND warehouse_code IS NOT NULL;

    ELSIF v_role = 'manager' THEN
        v_mode := 'team';
        SELECT t.name INTO v_name FROM onkey_technicians t
         WHERE lower(t.email) = v_email LIMIT 1;
        SELECT array_agg(DISTINCT w.warehouse_code) INTO v_warehouses
          FROM onkey_technicians t
          JOIN technician_warehouses w ON w.staff_code = t.staff_code
         WHERE w.status = 'verified'
           AND w.warehouse_code IS NOT NULL
           AND v_name IS NOT NULL
           AND lower(trim(t.manager)) = lower(trim(v_name));
        IF v_warehouses IS NULL OR cardinality(v_warehouses) = 0 THEN
            -- Said out loud rather than shown as an empty list, which
            -- would read as "your technicians carry nothing".
            v_reason := 'no technicians are recorded as reporting to you in OnKey';
        ELSE
            v_reason := format('%s van(s) across your technicians', cardinality(v_warehouses));
        END IF;

    ELSIF v_status = 'no_van' THEN
        v_mode := 'no_van';
        v_warehouses := NULL;
        v_reason := 'you hold no van stock, so parts here are for reference only';

    ELSIF v_status = 'verified' AND v_van IS NOT NULL THEN
        v_mode := 'van';
        v_warehouses := ARRAY[v_van];
        v_reason := coalesce(v_van_name, v_van);

    ELSE
        v_mode := 'unverified';
        v_warehouses := NULL;
        v_reason := 'your van is not set, so this is the full register rather than your stock';
    END IF;

    RETURN jsonb_build_object(
        'mode', v_mode,
        'reason', v_reason,
        'vanCode', v_van,
        'vanDescription', v_van_name,
        'warehouses', to_jsonb(coalesce(v_warehouses, ARRAY[]::text[])),
        'lastLoadedAt', syspro_last_load()
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION app_stock_scope() TO authenticated;

/** The picker, scoped. Same shape as before plus the quantity, so the
 * existing caller keeps working and can start showing the number. */
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
        SELECT coalesce(jsonb_agg(row ORDER BY rank, in_stock DESC, quantity DESC, item_code), '[]'::jsonb)
          INTO v_items
          FROM (
            SELECT jsonb_build_object(
                       'itemCode', s.stock_code,
                       'description', s.description,
                       'unit', coalesce(s.unit, 'EA'),
                       'quantity', round(sum(s.quantity_on_hand), 3),
                       'inStock', sum(s.quantity_on_hand) > 0,
                       'vanCount', count(DISTINCT s.warehouse)) AS row,
                   s.stock_code AS item_code,
                   sum(s.quantity_on_hand) > 0 AS in_stock,
                   sum(s.quantity_on_hand) AS quantity,
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
             ORDER BY rank, in_stock DESC, quantity DESC, s.stock_code
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

/** How many parts the CALLER can pick from, so an empty search can say
 * "no match in 1,100 parts on your van" rather than nothing at all. */
CREATE OR REPLACE FUNCTION app_stock_count()
RETURNS int
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_scope jsonb := app_stock_scope();
    v_warehouses text[];
    v_count int;
BEGIN
    SELECT array_agg(value::text) INTO v_warehouses
      FROM jsonb_array_elements_text(v_scope -> 'warehouses') AS value;

    IF (v_scope ->> 'mode') IN ('van', 'team', 'all')
       AND v_warehouses IS NOT NULL AND cardinality(v_warehouses) > 0 THEN
        SELECT count(DISTINCT s.stock_code)::int INTO v_count
          FROM syspro_stock s
         WHERE s.warehouse = ANY (v_warehouses)
           AND NOT EXISTS (
                 SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.stock_code);
    ELSE
        SELECT count(*)::int INTO v_count FROM stock_items s
         WHERE s.is_active
           AND NOT EXISTS (
                 SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.item_code);
    END IF;
    RETURN coalesce(v_count, 0);
END;
$function$;

GRANT EXECUTE ON FUNCTION app_stock_count() TO authenticated;
