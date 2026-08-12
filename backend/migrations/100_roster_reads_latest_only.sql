-- The roster refresh must read only the LATEST landing of each report
-- (#141 follow-up, found live on 2026-08-12).
--
-- Report rows are content-hashed: a row that changes arrives as a NEW row
-- while the old version stays behind with an older last_seen_at. The
-- owner deactivated users in OnKey, the fresh fetch landed 19 new rows,
-- and the count of ACTIVE rows did not move, because every deactivated
-- user still had their old active row in the table voting bool_or(true).
-- Read that way, nobody can ever be deactivated, which is the exact
-- failure #141 exists to prevent.
--
-- The fix scopes both CTEs to rows seen in the most recent landing: within
-- 30 minutes of the newest last_seen_at for that report. A fetch lands in
-- one batch, so the window is generous without ever spanning two nightly
-- runs.
--
-- Also stamps a tripwire: roster_status changes now require the stamp to
-- move with them. A trigger records any write to roster_status into
-- roster_status_audit, because yesterday a committed roster was reverted
-- with no trace and archaeology without a record is guessing.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS roster_status_audit (
    id bigserial PRIMARY KEY,
    staff_code varchar(32) NOT NULL,
    old_status varchar(16),
    new_status varchar(16),
    changed_at timestamptz NOT NULL DEFAULT now(),
    by_role text,
    by_query text
);
ALTER TABLE roster_status_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON roster_status_audit FROM anon, authenticated;

CREATE OR REPLACE FUNCTION roster_status_audit_fn()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.roster_status IS DISTINCT FROM OLD.roster_status THEN
        INSERT INTO roster_status_audit (staff_code, old_status, new_status, by_role, by_query)
        VALUES (NEW.staff_code, OLD.roster_status, NEW.roster_status,
                current_user, left(current_query(), 300));
    END IF;
    RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS roster_status_audit_trg ON technician_allocations;
CREATE TRIGGER roster_status_audit_trg
    BEFORE UPDATE ON technician_allocations
    FOR EACH ROW EXECUTE FUNCTION roster_status_audit_fn();

CREATE OR REPLACE FUNCTION onkey_roster_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_users int;
    v_staff int;
    v_current int;
    v_former int;
    v_unknown int;
BEGIN
    SELECT count(*) INTO v_users
      FROM onkey_report_rows
     WHERE report_code = 'FIELDOPS - USERS'
       AND last_seen_at >= (SELECT max(last_seen_at) - interval '30 minutes'
                              FROM onkey_report_rows WHERE report_code = 'FIELDOPS - USERS');
    SELECT count(*) INTO v_staff
      FROM onkey_report_rows
     WHERE report_code = 'FIELDOPS - STAFF'
       AND last_seen_at >= (SELECT max(last_seen_at) - interval '30 minutes'
                              FROM onkey_report_rows WHERE report_code = 'FIELDOPS - STAFF');

    IF v_users = 0 THEN
        RETURN jsonb_build_object(
            'applied', false,
            'reason', 'FIELDOPS - USERS has no recent rows, so the roster is left alone');
    END IF;

    WITH users AS (
        SELECT upper(trim(data ->> 'StaffMemberCode')) AS staff_code,
               lower(trim(data ->> 'IsActive')) = 'true' AS is_active
          FROM onkey_report_rows
         WHERE report_code = 'FIELDOPS - USERS'
           AND coalesce(trim(data ->> 'StaffMemberCode'), '') <> ''
           AND last_seen_at >= (SELECT max(last_seen_at) - interval '30 minutes'
                                  FROM onkey_report_rows WHERE report_code = 'FIELDOPS - USERS')
    ),
    staff AS (
        SELECT upper(trim(data ->> 'Code')) AS staff_code,
               lower(trim(data ->> 'IsActive')) = 'true' AS is_active
          FROM onkey_report_rows
         WHERE report_code = 'FIELDOPS - STAFF'
           AND coalesce(trim(data ->> 'Code'), '') <> ''
           AND last_seen_at >= (SELECT max(last_seen_at) - interval '30 minutes'
                                  FROM onkey_report_rows WHERE report_code = 'FIELDOPS - STAFF')
    ),
    resolved AS (
        SELECT a.staff_code,
               CASE
                   WHEN bool_or(u.is_active) THEN 'current'
                   WHEN count(u.staff_code) > 0 THEN 'former'
                   WHEN bool_or(s.is_active) THEN 'current'
                   ELSE 'former'
               END AS status
          FROM technician_allocations a
          LEFT JOIN users u ON u.staff_code = upper(trim(a.staff_code))
          LEFT JOIN staff s ON s.staff_code = upper(trim(a.staff_code))
         GROUP BY a.staff_code
    )
    UPDATE technician_allocations a
       SET roster_status = r.status,
           updated_at = now(),
           updated_by = 'onkey_roster_refresh'
      FROM resolved r
     WHERE a.staff_code = r.staff_code
       AND a.roster_status IS DISTINCT FROM r.status;

    SELECT count(*) FILTER (WHERE roster_status = 'current'),
           count(*) FILTER (WHERE roster_status = 'former')
      INTO v_current, v_former
      FROM technician_allocations;

    SELECT count(*) INTO v_unknown
      FROM technician_allocations a
     WHERE NOT EXISTS (
         SELECT 1 FROM onkey_report_rows r
          WHERE r.report_code IN ('FIELDOPS - USERS', 'FIELDOPS - STAFF')
            AND upper(trim(coalesce(r.data ->> 'StaffMemberCode', r.data ->> 'Code'))) = upper(trim(a.staff_code))
     );

    RETURN jsonb_build_object(
        'applied', true,
        'userRows', v_users,
        'staffRows', v_staff,
        'current', v_current,
        'former', v_former,
        'inNeitherReport', v_unknown);
END $function$;
