-- Managers of managers (#140).
--
-- Allocation was one level deep: technician -> manager (#139). Someone
-- above the branch managers has nobody allocated directly to them and so
-- saw nothing, which is the exact failure #139 set out to end.
--
-- Owner decision 2026-08-11: do this INSTEAD of using view-as to see other
-- people's data. Impersonation answers "what does Charl see", which is a
-- debugging question, and it makes every record touched ambiguous about
-- who was really looking. A senior manager seeing their own organisation
-- is not impersonating anybody.
--
-- No emails in this file. The repository is public and this is staff data
-- (POPIA); the edges are set against the live database.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS manager_hierarchy (
    manager_email varchar(255) PRIMARY KEY,
    /** NULL means top of the tree. Nullable rather than absent, so a
     * person can be recorded as reporting to nobody on purpose, which is
     * different from not being recorded at all. */
    reports_to_email varchar(255),
    note text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(255),
    CONSTRAINT manager_hierarchy_not_self CHECK (
        reports_to_email IS NULL
        OR lower(reports_to_email) <> lower(manager_email)
    )
);

CREATE INDEX IF NOT EXISTS manager_hierarchy_reports_to_idx
    ON manager_hierarchy (lower(reports_to_email));

ALTER TABLE manager_hierarchy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON manager_hierarchy FROM anon, authenticated;

/** Record who a manager reports to. Pass NULL to put them at the top. */
CREATE OR REPLACE FUNCTION manager_reports_to_set(
    p_manager_email text,
    p_reports_to_email text,
    p_note text DEFAULT NULL,
    p_by text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    INSERT INTO manager_hierarchy
        (manager_email, reports_to_email, note, updated_at, updated_by)
    VALUES (lower(trim(p_manager_email)),
            lower(nullif(trim(coalesce(p_reports_to_email, '')), '')),
            p_note, now(), p_by)
    ON CONFLICT (manager_email) DO UPDATE
       SET reports_to_email = excluded.reports_to_email,
           note = excluded.note,
           updated_at = now(),
           updated_by = excluded.updated_by;
$function$;

/** A manager plus every manager beneath them, at any depth.
 *
 * UNION rather than UNION ALL on purpose. A cycle introduced by a bad
 * edge (A reports to B reports to A) produces no new rows on the second
 * pass and the recursion stops. UNION ALL would spin for ever, and a hang
 * in here would take out every stock screen at once. The depth cap is
 * belt and braces on top of that: an organisation 20 managers deep is a
 * data error, not a company. */
CREATE OR REPLACE FUNCTION app_managers_beneath(p_email text)
RETURNS TABLE (manager_email text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH RECURSIVE tree AS (
        SELECT lower(trim(p_email)) AS email, 0 AS depth
         WHERE coalesce(trim(p_email), '') <> ''
        UNION
        SELECT lower(h.manager_email), t.depth + 1
          FROM manager_hierarchy h
          JOIN tree t ON lower(h.reports_to_email) = t.email
         WHERE t.depth < 20
    )
    SELECT email FROM tree;
$function$;

GRANT EXECUTE ON FUNCTION app_managers_beneath(text) TO authenticated;

/** The staff codes beneath the signed-in manager, at any depth.
 *
 * Replaces the direct-only version from #139. Everything that resolves a
 * team goes through this one function, so this is the only place the
 * hierarchy has to be understood. */
CREATE OR REPLACE FUNCTION app_team_staff_codes()
RETURNS TABLE (staff_code text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT a.staff_code::text
      FROM technician_allocations a
     WHERE a.active
       AND app_email() <> ''
       AND lower(coalesce(a.manager_email, '')) IN (
           SELECT m.manager_email FROM app_managers_beneath(app_email()) m
       );
$function$;

GRANT EXECUTE ON FUNCTION app_team_staff_codes() TO authenticated;

/** How many managers sit beneath the caller, not counting the caller.
 * Used only to word the scope, but worth naming rather than inlining a
 * "minus one" that reads like an off-by-one bug. */
CREATE OR REPLACE FUNCTION app_sub_manager_count()
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT greatest(0, count(*)::int - 1) FROM app_managers_beneath(app_email());
$function$;

GRANT EXECUTE ON FUNCTION app_sub_manager_count() TO authenticated;

-- Resolve the manager branch down the tree, and say which case it is.
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
    v_subs int;
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
        SELECT count(*) INTO v_team FROM app_team_staff_codes();
        v_subs := app_sub_manager_count();
        SELECT array_agg(DISTINCT w.warehouse_code) INTO v_warehouses
          FROM app_team_staff_codes() a
          JOIN technician_warehouses w ON w.staff_code = a.staff_code
         WHERE w.status = 'verified' AND w.warehouse_code IS NOT NULL;
        IF v_team = 0 THEN
            v_reason := 'no technicians are allocated to you yet';
        ELSIF v_warehouses IS NULL OR cardinality(v_warehouses) = 0 THEN
            v_reason := format('%s technician(s) beneath you, none with a verified van', v_team);
        ELSIF v_subs > 0 THEN
            -- Worth spelling out. "41 technicians" and "41 technicians
            -- across 6 managers" read very differently to someone
            -- checking they can see what they should.
            v_reason := format('%s van(s), %s technician(s) across %s manager(s) beneath you',
                               cardinality(v_warehouses), v_team, v_subs);
        ELSE
            v_reason := format('%s van(s) across %s technician(s)',
                               cardinality(v_warehouses), v_team);
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

-- Same change in the van list: a manager's technicians now come from the
-- whole tree, through the same single function.
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

/** The tree, for an admin to check. Names are not in the repository but
 * they are fine in a query result read by somebody entitled to it. */
CREATE OR REPLACE VIEW manager_hierarchy_tree AS
SELECT h.manager_email,
       h.reports_to_email,
       (SELECT count(*) FROM technician_allocations a
         WHERE a.active AND lower(a.manager_email) = lower(h.manager_email)) AS direct_technicians,
       (SELECT count(*) FROM app_managers_beneath(h.manager_email)) - 1 AS sub_managers
  FROM manager_hierarchy h;
