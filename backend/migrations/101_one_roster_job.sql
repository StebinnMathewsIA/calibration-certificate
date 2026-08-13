-- One nightly roster job instead of three (#149).
--
-- The three separate slots were a lottery. pg_cron starts each job on its
-- own worker, every minute of our day already carries two scheduled jobs,
-- the drain deliberately holds a worker for forty seconds on odd minutes,
-- and on the first night both fetch jobs failed with 'job startup
-- timeout' while the refresh, sixteen minutes later, started fine. Three
-- tickets in that lottery, nightly, was the design error.
--
-- Now ONE kick posts mode=roster to the backend, which fetches both
-- reports on one OnKey session and runs the refresh itself. A second kick
-- an hour later is the retry: the endpoint is single-flight and the
-- refresh is idempotent, so a duplicate is harmless. And because any slot
-- can still lose the lottery, ops_alerts gains roster_stale, which fires
-- when the users report has not landed for 26 hours: one nightly cadence
-- plus slack, so a single missed night is caught the same morning.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION onkey_sync_lease_seconds(p_mode text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE p_mode
        WHEN 'recent' THEN 300
        WHEN 'incremental' THEN 1800
        WHEN 'backfill' THEN 3600
        WHEN 'roster' THEN 900
        ELSE 300
    END;
$function$;

DO $$
BEGIN
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('onkey-users-fetch', 'onkey-staff-fetch', 'onkey-roster-refresh',
                       'onkey-roster-sync', 'onkey-roster-sync-retry');
    PERFORM cron.schedule('onkey-roster-sync', '23 1 * * *',
        $cron$SELECT onkey_sync_kick_guarded('roster')$cron$);
    PERFORM cron.schedule('onkey-roster-sync-retry', '37 2 * * *',
        $cron$SELECT onkey_sync_kick_guarded('roster')$cron$);
END $$;

CREATE OR REPLACE FUNCTION public.ops_alerts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH merged AS (
        SELECT jsonb_array_elements(ops_alerts_core()) AS a
        UNION ALL
        SELECT jsonb_build_object(
                   'key', 'syspro_stale',
                   'severity', 'warning',
                   'detail', jsonb_build_object(
                       'minutesAgo', syspro_minutes_stale(),
                       'lastLoadAt', syspro_last_load(),
                       'reason', 'van stock figures are no longer being refreshed'))
         WHERE syspro_last_load() IS NOT NULL
           AND syspro_minutes_stale() > 35
        UNION ALL
        SELECT jsonb_build_object(
                   'key', 'syspro_never_loaded',
                   'severity', 'warning',
                   'detail', jsonb_build_object(
                       'reason', 'stock has never been loaded from Syspro'))
         WHERE syspro_last_load() IS NULL
        UNION ALL
        SELECT jsonb_build_object(
                   'key', 'roster_stale',
                   'severity', 'warning',
                   'detail', jsonb_build_object(
                       'lastLandedAt', (SELECT max(last_seen_at) FROM onkey_report_rows
                                         WHERE report_code = 'FIELDOPS - USERS'),
                       'reason', 'who is still employed has not refreshed from OnKey, so a deactivation there is not reaching the app'))
         WHERE (SELECT max(last_seen_at) FROM onkey_report_rows
                 WHERE report_code = 'FIELDOPS - USERS') < now() - interval '26 hours'
    )
    SELECT coalesce(jsonb_agg(a), '[]'::jsonb) FROM merged;
$function$;
