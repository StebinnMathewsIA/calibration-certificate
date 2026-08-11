-- Data for the stock tab (#138): my van, or my team's vans.
--
-- AUTHORISATION LIVES HERE, not in the app. A technician asking for
-- somebody else's van gets nothing, whatever screen they came from.
--
-- Idempotent.

/** Is the caller allowed to see this technician's van?
 *
 * Themselves, anyone allocated to them (#139), or everything if they are
 * an admin. Deliberately a function rather than a condition repeated in
 * two places, because the second copy is the one that drifts. */
CREATE OR REPLACE FUNCTION app_may_see_van(p_staff_code text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT app_email() <> ''
       AND (
            app_role() = 'admin'
         OR trim(p_staff_code) = app_staff_code()
         OR EXISTS (SELECT 1 FROM app_team_staff_codes() t
                     WHERE t.staff_code = trim(p_staff_code))
       );
$function$;

GRANT EXECUTE ON FUNCTION app_may_see_van(text) TO authenticated;

/** The vans the caller may look at, each with its counts.
 *
 * A technician gets one row, their own. A manager gets their allocated
 * technicians. An admin gets everyone with a verified van.
 *
 * Technicians with no van still appear, with a null van code, because
 * "Sashern holds no stock" is information a manager wants and an absent
 * row is not (#131). */
CREATE OR REPLACE FUNCTION app_team_vans()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_role text := app_role();
    v_staff text := app_staff_code();
    v_rows jsonb;
BEGIN
    IF app_email() = '' THEN
        RETURN '[]'::jsonb;
    END IF;

    WITH scope AS (
        SELECT a.staff_code
          FROM technician_allocations a
         WHERE v_role = 'manager'
           AND a.active
           AND lower(coalesce(a.manager_email, '')) = app_email()
        UNION
        SELECT w.staff_code FROM technician_warehouses w WHERE v_role = 'admin'
        UNION
        SELECT v_staff WHERE v_role NOT IN ('manager', 'admin') AND v_staff IS NOT NULL
    ),
    counted AS (
        SELECT s.staff_code,
               t.name AS technician_name,
               w.warehouse_code,
               w.warehouse_description,
               coalesce(w.status, 'unverified') AS van_status,
               count(k.stock_code) FILTER (WHERE k.quantity_on_hand > 0)::int AS in_stock,
               count(k.stock_code)::int AS carried
          FROM scope s
          LEFT JOIN onkey_technicians t ON t.staff_code = s.staff_code
          LEFT JOIN technician_warehouses w ON w.staff_code = s.staff_code
          LEFT JOIN syspro_stock k ON k.warehouse = w.warehouse_code
         WHERE s.staff_code IS NOT NULL
         GROUP BY s.staff_code, t.name, w.warehouse_code, w.warehouse_description, w.status
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'staffCode', staff_code,
               'technicianName', technician_name,
               'vanCode', warehouse_code,
               'vanDescription', warehouse_description,
               'vanStatus', van_status,
               'inStock', in_stock,
               'carried', carried)
               ORDER BY in_stock DESC, technician_name, staff_code), '[]'::jsonb)
      INTO v_rows
      FROM counted;

    RETURN v_rows;
END;
$function$;

GRANT EXECUTE ON FUNCTION app_team_vans() TO authenticated;

/** One technician's van stock. Refuses anyone not entitled to it.
 *
 * Quantity orders, it does not filter, for the same reason as the picker
 * (#137): an item at zero that the van carries is a different thing from
 * an item the van does not carry, and hiding the first makes a stocked
 * van look empty. */
CREATE OR REPLACE FUNCTION app_van_stock(
    p_staff_code text DEFAULT NULL,
    p_query text DEFAULT '',
    p_limit int DEFAULT 200
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_staff text := coalesce(nullif(trim(coalesce(p_staff_code, '')), ''), app_staff_code());
    v_q text := coalesce(trim(p_query), '');
    v_limit int := greatest(1, least(coalesce(p_limit, 200), 500));
    v_van text;
    v_van_name text;
    v_status text;
    v_items jsonb;
BEGIN
    IF v_staff IS NULL OR NOT app_may_see_van(v_staff) THEN
        RETURN jsonb_build_object('allowed', false, 'items', '[]'::jsonb,
                                  'reason', 'this is not your van');
    END IF;

    SELECT w.warehouse_code, w.warehouse_description, w.status
      INTO v_van, v_van_name, v_status
      FROM technician_warehouses w
     WHERE w.staff_code = v_staff;

    IF v_status = 'no_van' THEN
        RETURN jsonb_build_object('allowed', true, 'staffCode', v_staff,
                                  'vanStatus', 'no_van', 'items', '[]'::jsonb,
                                  'lastLoadedAt', syspro_last_load(),
                                  'reason', 'this technician holds no van stock');
    END IF;
    IF v_van IS NULL THEN
        RETURN jsonb_build_object('allowed', true, 'staffCode', v_staff,
                                  'vanStatus', coalesce(v_status, 'unverified'),
                                  'items', '[]'::jsonb,
                                  'lastLoadedAt', syspro_last_load(),
                                  'reason', 'no van is recorded for this technician');
    END IF;

    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'itemCode', stock_code,
               'description', description,
               'unit', unit,
               'quantity', quantity,
               'inStock', quantity > 0)
               ORDER BY rank, quantity DESC, stock_code), '[]'::jsonb)
      INTO v_items
      FROM (
        SELECT s.stock_code,
               s.description,
               coalesce(s.unit, 'EA') AS unit,
               round(s.quantity_on_hand, 3) AS quantity,
               CASE
                   WHEN v_q = '' THEN 0
                   WHEN s.stock_code ILIKE v_q || '%' THEN 0
                   WHEN s.stock_code ILIKE '%' || v_q || '%' THEN 1
                   ELSE 2
               END AS rank
          FROM syspro_stock s
         WHERE s.warehouse = v_van
           AND (v_q = ''
                OR s.stock_code ILIKE '%' || v_q || '%'
                OR s.description ILIKE '%' || v_q || '%')
         ORDER BY rank, (s.quantity_on_hand > 0) DESC, s.quantity_on_hand DESC, s.stock_code
         LIMIT v_limit
      ) hits;

    RETURN jsonb_build_object(
        'allowed', true,
        'staffCode', v_staff,
        'vanCode', v_van,
        'vanDescription', v_van_name,
        'vanStatus', coalesce(v_status, 'unverified'),
        'lastLoadedAt', syspro_last_load(),
        'items', v_items
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION app_van_stock(text, text, int) TO authenticated;
