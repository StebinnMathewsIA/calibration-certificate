-- Stock counts on the allocation tree, and role labels a person would
-- write (#147).
--
-- The tree becomes the stock tab's team view, so each technician row
-- carries their in-stock and carried counts: one call serves both the
-- structure and the numbers, instead of the client stitching two RPCs.
--
-- The happy-path scope reason becomes a capitalised role with no trailing
-- description, on the owner's direction: "administrator, every van" told
-- an administrator two things they already knew. The PROBLEM states keep
-- their sentences, because "no technicians are allocated to you yet" is a
-- diagnosis, not a label, and shortening it to "Manager" would hide the
-- one thing the person needs to know.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION app_allocation_tree()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_role text := coalesce(app_role(), '');
    v_email text := app_email();
    v_managers jsonb;
BEGIN
    IF v_email = '' OR v_role NOT IN ('manager', 'admin') THEN
        RETURN jsonb_build_object('managers', '[]'::jsonb);
    END IF;

    WITH visible AS (
        SELECT h.manager_email, h.reports_to_email
          FROM manager_hierarchy h
         WHERE v_role = 'admin'
            OR h.manager_email IN (SELECT m.manager_email FROM app_managers_beneath(v_email) m)
    ),
    techs AS (
        SELECT coalesce(a.manager_email, unallocated_manager_email()) AS manager_email,
               a.staff_code,
               a.roster_status,
               t.name AS technician_name,
               w.warehouse_code,
               w.warehouse_description,
               coalesce(w.status, 'unverified') AS van_status,
               coalesce((SELECT count(*) FROM syspro_stock s
                          WHERE s.warehouse = w.warehouse_code
                            AND s.quantity_on_hand > 0), 0)::int AS in_stock,
               coalesce((SELECT count(*) FROM syspro_stock s
                          WHERE s.warehouse = w.warehouse_code), 0)::int AS carried
          FROM technician_allocations a
          LEFT JOIN onkey_technicians t ON t.staff_code = a.staff_code
          LEFT JOIN technician_warehouses w ON w.staff_code = a.staff_code
         WHERE a.active
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'email', v.manager_email,
               'name', manager_display_name(v.manager_email),
               'reportsTo', v.reports_to_email,
               'technicians', coalesce((
                   SELECT jsonb_agg(jsonb_build_object(
                              'staffCode', x.staff_code,
                              'technicianName', x.technician_name,
                              'rosterStatus', x.roster_status,
                              'vanCode', x.warehouse_code,
                              'vanDescription', x.warehouse_description,
                              'vanStatus', x.van_status,
                              'inStock', x.in_stock,
                              'carried', x.carried)
                              ORDER BY x.roster_status, x.in_stock DESC,
                                       x.technician_name, x.staff_code)
                     FROM techs x
                    WHERE lower(x.manager_email) = lower(v.manager_email)), '[]'::jsonb))
               ORDER BY v.manager_email), '[]'::jsonb)
      INTO v_managers
      FROM visible v;

    RETURN jsonb_build_object('managers', v_managers);
END;
$function$;

GRANT EXECUTE ON FUNCTION app_allocation_tree() TO authenticated;

-- Happy-path reasons become role labels; diagnoses stay sentences.
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

    IF v_role = 'admin' THEN
        v_mode := 'all';
        v_reason := 'Administrator';
        SELECT array_agg(DISTINCT warehouse_code) INTO v_warehouses
          FROM technician_warehouses
         WHERE status = 'verified' AND warehouse_code IS NOT NULL;

    ELSIF v_role = 'manager' THEN
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

GRANT EXECUTE ON FUNCTION app_stock_scope() TO authenticated;
