-- Who is still here, from OnKey rather than from a guess (#141).
--
-- The owner pointed out that FieldOps user reports exist. They do, and I
-- had said they did not: I searched the WSDL for an export service and
-- read our own reports spec, and never simply asked OnKey for the report
-- by name.
--
--   FIELDOPS - USERS   601 rows, 137 active. Code, IsActive,
--                      StaffMemberCode, StaffMemberEmail, names.
--   FIELDOPS - STAFF   595 rows, 359 active. Code, IsActive, Email,
--                      JobTitle, SiteCode, SectionTrade.
--
-- (FIELDOPS - USER, singular, does not exist, which is what threw the
-- first probe.)
--
-- THE RULE, and why it is not simply "is there an active user".
--
-- The owner's steer was that the user table is the right place, and it is:
-- USERS carries StaffMemberCode, so it joins to our register directly. But
-- an active employee with no OnKey LOGIN is a real thing, and retiring
-- them because OnKey never issued them one would be the same class of
-- mistake as the master-file inference this replaces. So the staff report
-- is the fallback, not a tie-breaker:
--
--   active user record                          -> current
--   inactive user record                        -> former
--   no user record, active staff record         -> current
--   no user record, inactive or absent in staff -> former
--
-- Against our 100 technicians today that gives roughly 84 current and 16
-- former, which matches what the owner said about old technicians.
--
-- NOTHING IS DELETED. Old work orders and certificates still resolve to a
-- name, which they must.
--
-- Idempotent.

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
    SELECT count(*) INTO v_users FROM onkey_report_rows WHERE report_code = 'FIELDOPS - USERS';
    SELECT count(*) INTO v_staff FROM onkey_report_rows WHERE report_code = 'FIELDOPS - STAFF';

    IF v_users = 0 THEN
        -- Refusing to act on an empty report is the whole point. A failed
        -- fetch would otherwise read as "everybody has left" and empty
        -- every manager's team in one go.
        RETURN jsonb_build_object(
            'applied', false,
            'reason', 'FIELDOPS - USERS has no rows, so the roster is left alone');
    END IF;

    WITH users AS (
        SELECT upper(trim(data ->> 'StaffMemberCode')) AS staff_code,
               lower(trim(data ->> 'IsActive')) = 'true' AS is_active
          FROM onkey_report_rows
         WHERE report_code = 'FIELDOPS - USERS'
           AND coalesce(trim(data ->> 'StaffMemberCode'), '') <> ''
    ),
    staff AS (
        SELECT upper(trim(data ->> 'Code')) AS staff_code,
               lower(trim(data ->> 'IsActive')) = 'true' AS is_active
          FROM onkey_report_rows
         WHERE report_code = 'FIELDOPS - STAFF'
           AND coalesce(trim(data ->> 'Code'), '') <> ''
    ),
    -- A person can hold more than one user record. Any active one counts.
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

/** Fetch an Analyser report on a schedule, through the same lease every
 * other OnKey job takes. Without the lease this would be a third export
 * landing on top of the sweep in a 512 MB process (#134). */
CREATE OR REPLACE FUNCTION onkey_report_fetch_kick(p_report_code text, p_max int DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    token text;
    base text;
    req_id bigint;
BEGIN
    IF NOT onkey_take_session_lease('report:' || p_report_code, 600) THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'another OnKey job holds the session lease');
    END IF;

    SELECT decrypted_secret INTO token
      FROM vault.decrypted_secrets WHERE name = 'onkey_sync_token';
    SELECT decrypted_secret INTO base
      FROM vault.decrypted_secrets WHERE name = 'onkey_api_base_url';
    base := coalesce(nullif(base, ''), 'https://prowalco-calibration-api.onrender.com');

    IF coalesce(token, '') = '' THEN
        PERFORM onkey_release_session_lease('report:' || p_report_code);
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'vault secret onkey_sync_token is not set');
    END IF;

    SELECT net.http_post(
        url := base || '/v1/onkey/probe-report',
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || token,
            'Content-Type', 'application/json'),
        body := jsonb_build_object('reportCode', p_report_code, 'maxRecords', p_max),
        timeout_milliseconds := 300000
    ) INTO req_id;

    RETURN jsonb_build_object('kicked', true, 'report', p_report_code, 'requestId', req_id);
END $function$;

DO $$
BEGIN
    -- Both reports, then the roster derived from them, in that order and
    -- spaced so each fetch is finished before the next starts. Nightly:
    -- somebody joining or leaving is not a minute-by-minute event, and
    -- every one of these takes an OnKey session.
    PERFORM cron.unschedule('onkey-users-fetch')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-users-fetch');
    PERFORM cron.schedule('onkey-users-fetch', '53 0 * * *',
        $cron$SELECT onkey_report_fetch_kick('FIELDOPS - USERS')$cron$);

    PERFORM cron.unschedule('onkey-staff-fetch')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-staff-fetch');
    PERFORM cron.schedule('onkey-staff-fetch', '59 0 * * *',
        $cron$SELECT onkey_report_fetch_kick('FIELDOPS - STAFF')$cron$);

    PERFORM cron.unschedule('onkey-roster-refresh')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-roster-refresh');
    PERFORM cron.schedule('onkey-roster-refresh', '9 1 * * *',
        $cron$SELECT onkey_roster_refresh()$cron$);
END $$;
