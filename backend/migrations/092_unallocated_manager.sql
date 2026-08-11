-- An explicit "unallocated" manager, and back out the leaver inference.
--
-- TWO OWNER CORRECTIONS, 2026-08-11.
--
-- 1. "Have an unallocated manager so all unallocated technicians go there
--    and the admin people can see these technicians."
--
--    Nobody should be invisible because nobody has claimed them. A
--    technician with no manager was reachable only by an admin, whose view
--    is deliberately different, so they fell out of every organisational
--    screen. They now sit under a named holder that reports into the tree,
--    which makes "not yet allocated" a visible state rather than an
--    absence.
--
-- 2. The roster split in migration 091 inferred leavers from which fields
--    the technician master had filled in. The owner has since said the
--    active flag should come from a system of record instead. That
--    inference is therefore backed out here: everyone returns to
--    'current' and nobody is retired on a guess.
--
--    The roster_status column and allocation_roster_set() STAY. The
--    mechanism is right and will be driven by a real signal once we have
--    one; see #141. What was wrong was the source, not the shape.
--
-- The sentinel address uses .invalid, reserved by RFC 2606 and guaranteed
-- never to resolve, so it cannot collide with anyone's sign-in and cannot
-- accidentally be mailed.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION unallocated_manager_email()
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT 'unallocated@prowalco.invalid'::text;
$function$;

GRANT EXECUTE ON FUNCTION unallocated_manager_email() TO authenticated;

-- Undo the inferred leavers. Owner's call: OnKey, not our guess (#141).
UPDATE technician_allocations
   SET roster_status = 'current',
       updated_at = now(),
       note = coalesce(note, '')
 WHERE roster_status = 'former';

/** Put the holder into the tree so it is somebody's to look at.
 *
 * It reports to the same person the branch managers do, rather than to
 * the very top, so that both senior people see unallocated technicians.
 * Parking it at the top would have hidden them from everyone but one
 * person, which is the problem this is meant to solve. */
INSERT INTO manager_hierarchy (manager_email, reports_to_email, note)
SELECT unallocated_manager_email(),
       (SELECT h.reports_to_email
          FROM manager_hierarchy h
         WHERE h.reports_to_email IS NOT NULL
         GROUP BY h.reports_to_email
         ORDER BY count(*) DESC
         LIMIT 1),
       'holder for technicians nobody has allocated yet'
ON CONFLICT (manager_email) DO NOTHING;

-- Everyone currently unclaimed goes to the holder.
UPDATE technician_allocations
   SET manager_email = unallocated_manager_email(),
       updated_at = now(),
       note = 'not yet allocated to a manager'
 WHERE active
   AND roster_status = 'current'
   AND coalesce(manager_email, '') = '';

/** The work list is now "allocated to the holder", not "allocated to
 * nobody". Same people, but they are visible in the app while they wait
 * rather than only in a query somebody has to remember to run. */
CREATE OR REPLACE VIEW technician_allocations_unallocated AS
SELECT a.staff_code,
       w.warehouse_code,
       w.status AS van_status
  FROM technician_allocations a
  LEFT JOIN technician_warehouses w ON w.staff_code = a.staff_code
 WHERE a.active
   AND a.roster_status = 'current'
   AND (coalesce(a.manager_email, '') = ''
        OR lower(a.manager_email) = unallocated_manager_email());

/** Keep new technicians from disappearing. Anyone who arrives from an
 * OnKey sync with no manager lands on the holder instead of nowhere. */
CREATE OR REPLACE FUNCTION allocation_sweep_unallocated()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_new int;
BEGIN
    INSERT INTO technician_allocations (staff_code, manager_email, source, note)
    SELECT t.staff_code, unallocated_manager_email(), 'onkey',
           'arrived from an OnKey sync with no manager'
      FROM onkey_technicians t
     WHERE coalesce(t.staff_code, '') <> ''
    ON CONFLICT (staff_code) DO NOTHING;
    GET DIAGNOSTICS v_new = ROW_COUNT;

    UPDATE technician_allocations
       SET manager_email = unallocated_manager_email(), updated_at = now()
     WHERE active
       AND roster_status = 'current'
       AND coalesce(manager_email, '') = '';

    RETURN v_new;
END;
$function$;
