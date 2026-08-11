-- Current establishment versus old technicians (#139, #140).
--
-- Owner, 2026-08-11: "What was shared in the technician master file was the
-- source of truth, all other technicians are actually old technicians."
--
-- So 72 unallocated technicians was never a data-entry backlog. Most of
-- them are people who have left, and allocating them to a manager would
-- have been wrong work done carefully.
--
-- HOW WE TELL THEM APART, measured rather than assumed. The master file
-- carried first name, last name, manager and a base location. The OnKey
-- work-order sync knows only a staff code and a display name, so anybody
-- it created has none of those:
--
--   field            master-file set (78)   the rest (22)
--   first_name                        78                1
--   manager                           78                0
--   base latitude                     69                0
--   email                             78               10
--
-- A technician with no first name and no manager was never in the master
-- file. They exist because their staff code appears on an old work order.
--
-- NOTHING IS DELETED. Work orders and certificates from years past still
-- point at these people and must keep resolving to a name. This is a flag
-- on our own register, and it is reversible with one UPDATE.
--
-- Idempotent.

ALTER TABLE technician_allocations
    ADD COLUMN IF NOT EXISTS roster_status varchar(16);

UPDATE technician_allocations a
   SET roster_status = CASE
       WHEN EXISTS (
           SELECT 1 FROM onkey_technicians t
            WHERE t.staff_code = a.staff_code
              AND (coalesce(trim(t.first_name), '') <> ''
                   OR coalesce(trim(t.manager), '') <> '')
       ) THEN 'current'
       ELSE 'former'
   END
 WHERE roster_status IS NULL;

ALTER TABLE technician_allocations
    ALTER COLUMN roster_status SET DEFAULT 'current';
ALTER TABLE technician_allocations
    ALTER COLUMN roster_status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint
                    WHERE conname = 'technician_allocations_roster_check') THEN
        ALTER TABLE technician_allocations
            ADD CONSTRAINT technician_allocations_roster_check
            CHECK (roster_status IN ('current', 'former'));
    END IF;
END $$;

/** Mark somebody as having left, or as back. Manual, because a leaver is
 * a statement about a person and not something to infer twice. */
CREATE OR REPLACE FUNCTION allocation_roster_set(
    p_staff_code text,
    p_status text,
    p_by text DEFAULT NULL
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    UPDATE technician_allocations
       SET roster_status = p_status, updated_at = now(), updated_by = p_by
     WHERE staff_code = trim(p_staff_code)
       AND p_status IN ('current', 'former');
$function$;

-- The work list stops counting leavers. That was the whole point: 72
-- unallocated read as a backlog when most of it was history.
CREATE OR REPLACE VIEW technician_allocations_unallocated AS
SELECT a.staff_code,
       w.warehouse_code,
       w.status AS van_status
  FROM technician_allocations a
  LEFT JOIN technician_warehouses w ON w.staff_code = a.staff_code
 WHERE a.active
   AND a.roster_status = 'current'
   AND coalesce(a.manager_email, '') = '';

/** Former technicians still holding a verified van. Worth watching: a van
 * allocated to somebody who has left is either a stale mapping or a van
 * somebody else is now driving, and both matter to the stock figures. */
CREATE OR REPLACE VIEW technician_allocations_former_with_van AS
SELECT a.staff_code, w.warehouse_code, w.warehouse_description
  FROM technician_allocations a
  JOIN technician_warehouses w ON w.staff_code = a.staff_code
 WHERE a.roster_status = 'former'
   AND w.status = 'verified'
   AND w.warehouse_code IS NOT NULL;

-- A leaver drops out of a manager's team, and out of the stock scope with
-- it. Their history is untouched; this is about who is on a van today.
CREATE OR REPLACE FUNCTION app_team_staff_codes()
RETURNS TABLE (staff_code text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT a.staff_code::text
      FROM technician_allocations a
     WHERE a.active
       AND a.roster_status = 'current'
       AND app_email() <> ''
       AND lower(coalesce(a.manager_email, '')) IN (
           SELECT m.manager_email FROM app_managers_beneath(app_email()) m
       );
$function$;

GRANT EXECUTE ON FUNCTION app_team_staff_codes() TO authenticated;
