-- We own manager to technician allocation (#139).
--
-- Owner decision 2026-08-11. OnKey seeds this and stops governing it.
--
-- WHY. OnKey stores the relationship as a NAME in a text column on the
-- technician's record. Resolving a signed-in manager to their team meant
-- matching their email to that name, and only two of the six people named
-- as a manager have a technician record of their own to match against
-- (#137). Allocating by EMAIL removes the translation: that is the
-- identity a manager actually signs in with, so nothing depends on a name
-- being spelled the same way in two systems by two different people.
--
-- Same split already used for sites and dispensers: OnKey is an external
-- seed that may be partial, our record is canonical, resolution is our
-- store then the seed then blank, and nothing is ever hard-deleted.
--
-- No names or emails in this file. The repository is public and this is
-- staff data (POPIA). The seed derives what it can by query.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS technician_allocations (
    staff_code varchar(32) PRIMARY KEY,
    /** The manager's SIGN-IN email, which is the whole point. Nullable:
     * unallocated is a real and visible state, not an error. */
    manager_email varchar(255),
    /** 'onkey' seeded from their manager column, 'manual' set by us.
     * A manual row is never overwritten by a later seed. */
    source varchar(16) NOT NULL DEFAULT 'onkey',
    active boolean NOT NULL DEFAULT true,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar(255)
);

CREATE INDEX IF NOT EXISTS technician_allocations_manager_idx
    ON technician_allocations (lower(manager_email)) WHERE active;

ALTER TABLE technician_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON technician_allocations FROM anon, authenticated;

-- Seed every technician, allocated where OnKey's name resolves to an email
-- through the mapping from #137, unallocated otherwise. Unallocated rows
-- are created deliberately: a missing row and an unowned technician are
-- different things, and only one of them is somebody's job to fix.
INSERT INTO technician_allocations (staff_code, manager_email, source, note)
SELECT t.staff_code,
       (SELECT m.email FROM manager_names m
         WHERE lower(trim(m.onkey_manager_name)) = lower(trim(t.manager))
         LIMIT 1),
       'onkey',
       'seeded from the OnKey manager column'
  FROM onkey_technicians t
 WHERE coalesce(t.staff_code, '') <> ''
ON CONFLICT (staff_code) DO NOTHING;

/** Allocate a technician to a manager, or to nobody. Marks the row
 * 'manual', so a later OnKey seed cannot quietly undo a decision someone
 * made on purpose. */
CREATE OR REPLACE FUNCTION allocation_set(
    p_staff_code text,
    p_manager_email text,
    p_note text DEFAULT NULL,
    p_by text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    INSERT INTO technician_allocations
        (staff_code, manager_email, source, active, note, updated_at, updated_by)
    VALUES (trim(p_staff_code), lower(nullif(trim(coalesce(p_manager_email, '')), '')),
            'manual', true, p_note, now(), p_by)
    ON CONFLICT (staff_code) DO UPDATE
       SET manager_email = excluded.manager_email,
           source = 'manual',
           active = true,
           note = excluded.note,
           updated_at = now(),
           updated_by = excluded.updated_by;
$function$;

/** Technicians nobody owns. A work list, and a view so it cannot go
 * stale. */
CREATE OR REPLACE VIEW technician_allocations_unallocated AS
SELECT a.staff_code,
       w.warehouse_code,
       w.status AS van_status
  FROM technician_allocations a
  LEFT JOIN technician_warehouses w ON w.staff_code = a.staff_code
 WHERE a.active
   AND coalesce(a.manager_email, '') = '';

/** The staff codes reporting to the signed-in manager. Keyed on email,
 * with no name matching anywhere on this path, which is the point of
 * #139. */
CREATE OR REPLACE FUNCTION app_team_staff_codes()
RETURNS TABLE (staff_code text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT a.staff_code::text
      FROM technician_allocations a
     WHERE a.active
       AND lower(coalesce(a.manager_email, '')) = app_email()
       AND app_email() <> '';
$function$;

GRANT EXECUTE ON FUNCTION app_team_staff_codes() TO authenticated;

-- Resolve a manager's stock scope through the register rather than the
-- OnKey name. Everything else about this function is unchanged.
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
        v_reason := 'administrator, every van';
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
            -- Named cause. Allocation is ours now, so this is a thing
            -- somebody can fix in the app rather than a mismatch between
            -- two systems.
            v_reason := 'no technicians are allocated to you yet';
        ELSIF v_warehouses IS NULL OR cardinality(v_warehouses) = 0 THEN
            v_reason := format('%s technician(s) allocated to you, none with a verified van', v_team);
        ELSE
            v_reason := format('%s van(s) across %s technician(s)', cardinality(v_warehouses), v_team);
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
