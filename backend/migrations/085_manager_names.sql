-- Map a signed-in manager to the name OnKey calls them (#137).
--
-- THE PROBLEM. onkey_technicians.manager holds a NAME. To find a manager's
-- team we need to go from their sign-in email to that name, and the obvious
-- route, look the manager up in onkey_technicians by email, only works if
-- the manager is also a technician there. Measured: of the six names that
-- appear as somebody's manager, only two have a record of their own. The
-- other four exist solely as text on other people's rows.
--
-- So four managers would have signed in and been told they have no team,
-- with nothing to say why. Not a bug we would have heard about quickly:
-- "the stock tab is empty" is exactly what a manager with no reports
-- should see.
--
-- THE FIX is a small mapping table, kept by hand, because OnKey does not
-- carry the link and inventing one from name heuristics would be worse
-- than admitting we do not know. Two rows seed themselves; the rest are
-- entered once and are then permanent.
--
-- No names or emails are written into this migration. The repository is
-- public and this is staff data (POPIA). The seed derives what it can by
-- query, and the remainder is entered against the live database.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS manager_names (
    email varchar(255) PRIMARY KEY,
    onkey_manager_name text NOT NULL,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE manager_names ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON manager_names FROM anon, authenticated;

-- The two that can be derived. Anyone whose own technician record carries
-- the same name that appears as somebody's manager.
INSERT INTO manager_names (email, onkey_manager_name, note)
SELECT lower(m.email), m.name, 'derived: this manager has their own technician record'
  FROM onkey_technicians m
 WHERE coalesce(m.email, '') <> ''
   AND EXISTS (
       SELECT 1 FROM onkey_technicians t
        WHERE lower(trim(t.manager)) = lower(trim(m.name))
   )
ON CONFLICT (email) DO NOTHING;

/** Record a manager's OnKey name by hand. Manual on purpose: it is a
 * statement about who somebody is, and a guess here quietly hands one
 * manager another manager's team. */
CREATE OR REPLACE FUNCTION manager_name_set(p_email text, p_name text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    INSERT INTO manager_names (email, onkey_manager_name, note, updated_at)
    VALUES (lower(trim(p_email)), trim(p_name), p_note, now())
    ON CONFLICT (email) DO UPDATE
       SET onkey_manager_name = excluded.onkey_manager_name,
           note = excluded.note,
           updated_at = now();
$function$;

/** Manager names that lead a team but that nobody can sign in as, because
 * no email maps to them. This is the work list, and it is a view so it
 * cannot go stale. */
CREATE OR REPLACE VIEW manager_names_unmapped AS
SELECT DISTINCT trim(t.manager) AS onkey_manager_name,
       count(*) OVER (PARTITION BY trim(t.manager)) AS reports
  FROM onkey_technicians t
 WHERE coalesce(trim(t.manager), '') <> ''
   AND NOT EXISTS (
       SELECT 1 FROM manager_names m
        WHERE lower(trim(m.onkey_manager_name)) = lower(trim(t.manager))
   );

/** The signed-in caller's name as OnKey writes it. Mapping table first,
 * then their own technician record. NULL means we genuinely do not know,
 * and every caller of this treats that as "say so" rather than "empty". */
CREATE OR REPLACE FUNCTION app_manager_name()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(
        (SELECT m.onkey_manager_name FROM manager_names m WHERE m.email = app_email()),
        (SELECT t.name FROM onkey_technicians t WHERE lower(t.email) = app_email() LIMIT 1)
    );
$function$;

GRANT EXECUTE ON FUNCTION app_manager_name() TO authenticated;

-- Rebuild the scope function to use it. Same contract, one changed lookup
-- and a reason that names the actual cause when a manager has no team.
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
        v_name := app_manager_name();
        IF v_name IS NULL THEN
            -- The specific cause, not a shrug. Four of six managers hit
            -- this: OnKey names them on their technicians' records but
            -- gives them no record of their own to match an email to.
            v_reason := 'your OnKey manager name is not mapped to your sign-in, so your team cannot be resolved';
        ELSE
            SELECT array_agg(DISTINCT w.warehouse_code) INTO v_warehouses
              FROM onkey_technicians t
              JOIN technician_warehouses w ON w.staff_code = t.staff_code
             WHERE w.status = 'verified'
               AND w.warehouse_code IS NOT NULL
               AND lower(trim(t.manager)) = lower(trim(v_name));
            IF v_warehouses IS NULL OR cardinality(v_warehouses) = 0 THEN
                v_reason := format('no technicians are recorded in OnKey as reporting to %s', v_name);
            ELSE
                v_reason := format('%s van(s) across your technicians', cardinality(v_warehouses));
            END IF;
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
