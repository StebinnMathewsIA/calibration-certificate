-- Fix app_team_vans for a plain technician (#138).
--
-- app_role() returns NULL for someone with no row in app_roles, which is
-- every technician. The scope branch read:
--
--   WHERE v_role NOT IN ('manager', 'admin')
--
-- and NULL NOT IN (...) is NULL, not true, so the technician's own van was
-- filtered out and the Stock tab showed them nothing at all. The two
-- branches above it compare with = and are unaffected, which is why the
-- manager and admin paths looked fine.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION app_team_vans()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_role text := coalesce(app_role(), '');
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
