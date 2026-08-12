-- Data for the reorganised stock tab (#145) and the allocation screens
-- (#146): vans grouped by manager, the reporting tree, a technician
-- detail, and an admin-only move.
--
-- Idempotent.

/** A manager's display name, best effort: the mapping table's OnKey name,
 * then their own technician record, then the email itself. The
 * unallocated holder gets a plain word, because a sentinel address shown
 * to a person is a bug report waiting to be filed. */
CREATE OR REPLACE FUNCTION manager_display_name(p_email text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN lower(coalesce(p_email, '')) = unallocated_manager_email() THEN 'Unallocated'
        WHEN coalesce(p_email, '') = '' THEN 'Unallocated'
        ELSE coalesce(
            (SELECT m.onkey_manager_name FROM manager_names m
              WHERE m.email = lower(p_email) LIMIT 1),
            (SELECT t.name FROM onkey_technicians t
              WHERE lower(t.email) = lower(p_email) LIMIT 1),
            p_email)
    END;
$function$;

GRANT EXECUTE ON FUNCTION manager_display_name(text) TO authenticated;

-- The van list gains its manager, so the stock tab can group without a
-- second call (#145). Everything else is unchanged from migration 089.
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
        SELECT t.staff_code FROM app_team_staff_codes() t WHERE v_role = 'manager'
        UNION
        SELECT a.staff_code FROM technician_allocations a
         WHERE v_role = 'admin' AND a.active AND a.roster_status = 'current'
        UNION
        SELECT v_staff WHERE v_role NOT IN ('manager', 'admin') AND v_staff IS NOT NULL
    ),
    counted AS (
        SELECT s.staff_code,
               t.name AS technician_name,
               w.warehouse_code,
               w.warehouse_description,
               coalesce(w.status, 'unverified') AS van_status,
               coalesce(a.manager_email, unallocated_manager_email()) AS manager_email,
               count(k.stock_code) FILTER (WHERE k.quantity_on_hand > 0)::int AS in_stock,
               count(k.stock_code)::int AS carried
          FROM scope s
          LEFT JOIN onkey_technicians t ON t.staff_code = s.staff_code
          LEFT JOIN technician_warehouses w ON w.staff_code = s.staff_code
          LEFT JOIN technician_allocations a ON a.staff_code = s.staff_code
          LEFT JOIN syspro_stock k ON k.warehouse = w.warehouse_code
         WHERE s.staff_code IS NOT NULL
         GROUP BY s.staff_code, t.name, w.warehouse_code, w.warehouse_description,
                  w.status, a.manager_email
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'staffCode', staff_code,
               'technicianName', technician_name,
               'vanCode', warehouse_code,
               'vanDescription', warehouse_description,
               'vanStatus', van_status,
               'managerEmail', manager_email,
               'managerName', manager_display_name(manager_email),
               'inStock', in_stock,
               'carried', carried)
               ORDER BY in_stock DESC, technician_name, staff_code), '[]'::jsonb)
      INTO v_rows
      FROM counted;

    RETURN v_rows;
END;
$function$;

GRANT EXECUTE ON FUNCTION app_team_vans() TO authenticated;

/** The reporting tree beneath the caller (#146). Admin: the whole forest.
 *
 * Flat nodes with a parent pointer rather than nested JSON, because the
 * client renders collapsible sections and a flat list with parents is
 * both easier to build recursively-safely here and easier to group
 * there. Former technicians are included and flagged: an admin is
 * exactly who needs to see them (#141). */
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
               coalesce(w.status, 'unverified') AS van_status
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
                              'vanStatus', x.van_status)
                              ORDER BY x.roster_status, x.technician_name, x.staff_code)
                     FROM techs x
                    WHERE lower(x.manager_email) = lower(v.manager_email)), '[]'::jsonb))
               ORDER BY v.manager_email), '[]'::jsonb)
      INTO v_managers
      FROM visible v;

    RETURN jsonb_build_object('managers', v_managers);
END;
$function$;

GRANT EXECUTE ON FUNCTION app_allocation_tree() TO authenticated;

/** One technician, for the detail page (#146). Same entitlement as their
 * van stock: yourself, your tree, or admin. */
CREATE OR REPLACE FUNCTION app_technician_detail(p_staff_code text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_staff text := trim(coalesce(p_staff_code, ''));
    v_row jsonb;
BEGIN
    IF v_staff = '' OR NOT app_may_see_van(v_staff) THEN
        RETURN jsonb_build_object('allowed', false);
    END IF;

    SELECT jsonb_build_object(
               'allowed', true,
               'staffCode', a.staff_code,
               'technicianName', t.name,
               'email', t.email,
               'rosterStatus', a.roster_status,
               'managerEmail', coalesce(a.manager_email, unallocated_manager_email()),
               'managerName', manager_display_name(coalesce(a.manager_email, unallocated_manager_email())),
               'allocationSource', a.source,
               'allocationUpdatedAt', a.updated_at,
               'allocationUpdatedBy', a.updated_by,
               'vanCode', w.warehouse_code,
               'vanDescription', w.warehouse_description,
               'vanStatus', coalesce(w.status, 'unverified'),
               'inStock', (SELECT count(*) FROM syspro_stock s
                            WHERE s.warehouse = w.warehouse_code
                              AND s.quantity_on_hand > 0),
               'carried', (SELECT count(*) FROM syspro_stock s
                            WHERE s.warehouse = w.warehouse_code))
      INTO v_row
      FROM technician_allocations a
      LEFT JOIN onkey_technicians t ON t.staff_code = a.staff_code
      LEFT JOIN technician_warehouses w ON w.staff_code = a.staff_code
     WHERE a.staff_code = v_staff;

    RETURN coalesce(v_row, jsonb_build_object('allowed', false));
END;
$function$;

GRANT EXECUTE ON FUNCTION app_technician_detail(text) TO authenticated;

/** The managers a technician can be moved to: everyone in the hierarchy
 * plus the holder. For the detail page's picker. */
CREATE OR REPLACE FUNCTION app_allocation_targets()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'email', x.email,
               'name', manager_display_name(x.email)) ORDER BY x.email), '[]'::jsonb)
      FROM (
        SELECT h.manager_email AS email FROM manager_hierarchy h
        UNION
        SELECT unallocated_manager_email()
      ) x;
$function$;

GRANT EXECUTE ON FUNCTION app_allocation_targets() TO authenticated;

/** Move a technician to another manager, or to Unallocated. Admin only,
 * and enforced HERE: the screen hiding the button is presentation, this
 * is the rule. Writes through allocation_set so the row is marked manual
 * and a later OnKey seed cannot quietly undo a decision a person made. */
CREATE OR REPLACE FUNCTION app_allocation_move(p_staff_code text, p_manager_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_staff text := trim(coalesce(p_staff_code, ''));
    v_target text := lower(trim(coalesce(p_manager_email, '')));
BEGIN
    IF coalesce(app_role(), '') <> 'admin' THEN
        RAISE EXCEPTION 'Only an administrator can move a technician between managers';
    END IF;
    IF v_staff = '' OR NOT EXISTS (
        SELECT 1 FROM technician_allocations a WHERE a.staff_code = v_staff) THEN
        RAISE EXCEPTION 'Unknown technician';
    END IF;
    -- The target must be a manager we know about, or the holder. A typo
    -- here would otherwise allocate someone to an email nobody signs in
    -- with, which is the unallocated state wearing a disguise.
    IF v_target <> unallocated_manager_email() AND NOT EXISTS (
        SELECT 1 FROM manager_hierarchy h WHERE h.manager_email = v_target) THEN
        RAISE EXCEPTION 'The target is not a known manager';
    END IF;

    PERFORM allocation_set(v_staff, v_target, 'moved in the app', app_email());
    RETURN app_technician_detail(v_staff);
END;
$function$;

GRANT EXECUTE ON FUNCTION app_allocation_move(text, text) TO authenticated;
