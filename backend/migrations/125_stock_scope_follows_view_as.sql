-- 125_stock_scope_follows_view_as.sql (#210)
--
-- Work as (#77) means the whole read surface resolves to the viewed
-- technician, but app_stock_scope's admin/manager branches won on role
-- alone: an admin viewing as a technician still got the full Teams
-- hierarchy ("I shouldn't have access to other teams stock", owner,
-- 22 Aug). The role branches now yield whenever a view-as is active
-- (app_staff_code() non-null for a role user only when view-as is set),
-- so the technician branches run for the viewed staff code and the tab
-- renders that one van. Body otherwise verbatim from 099.
CREATE OR REPLACE FUNCTION app_stock_scope()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_email text := app_email();
    v_role text := coalesce(app_role(), '');
    v_staff text := app_staff_code();
    v_status text;
    v_van text;
    v_van_name text;
    v_warehouses text[];
    v_team int;
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

    IF v_role = 'admin' AND v_staff IS NULL THEN
        v_mode := 'all';
        v_reason := 'Administrator';
        SELECT array_agg(DISTINCT warehouse_code) INTO v_warehouses
          FROM technician_warehouses
         WHERE status = 'verified' AND warehouse_code IS NOT NULL;

    ELSIF v_role = 'manager' AND v_staff IS NULL THEN
        v_mode := 'team';
        SELECT count(*) INTO v_team FROM app_team_staff_codes();
        SELECT array_agg(DISTINCT w.warehouse_code) INTO v_warehouses
          FROM app_team_staff_codes() a
          JOIN technician_warehouses w ON w.staff_code = a.staff_code
         WHERE w.status = 'verified' AND w.warehouse_code IS NOT NULL;
        IF v_team = 0 THEN
            v_reason := 'no technicians are allocated to you yet';
        ELSIF v_warehouses IS NULL OR cardinality(v_warehouses) = 0 THEN
            v_reason := format('%s technician(s) beneath you, none with a verified van', v_team);
        ELSE
            v_reason := 'Manager';
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
