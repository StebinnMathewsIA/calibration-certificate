-- Stock that has stopped refreshing joins the ops alerts (#142, #61).
--
-- The other alerts already cover OnKey going quiet. Nothing watched the
-- Syspro side, so a stalled load would first have shown up as a
-- technician acting on an old van figure, which is the worst way to find
-- out.
--
-- Thirty-five minutes is three missed incremental runs on a ten-minute
-- schedule, so a single blip raises nothing.
--
-- SHAPE. The existing alert set is lifted verbatim into ops_alerts_core()
-- and ops_alerts() becomes a wrapper that appends. Copying the branches
-- into a rewritten function would have worked once and then drifted the
-- moment either copy was edited.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.ops_alerts_core()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH last_sync AS (
        SELECT max(finished_at) AS at
          FROM onkey_sync_runs
         WHERE state = 'succeeded'
    ),
    recent AS (
        SELECT count(*) FILTER (WHERE state = 'failed') AS failed,
               count(*) AS total,
               (array_agg(error ORDER BY started_at DESC)
                FILTER (WHERE state = 'failed'))[1] AS last_error
          FROM onkey_sync_runs
         WHERE started_at > now() - interval '30 minutes'
    ),
    alerts AS (
        SELECT 'sync_stalled' AS alert_key, 'critical' AS severity,
               jsonb_build_object(
                   'lastSuccessAt', (SELECT at FROM last_sync),
                   'minutesAgo', round(extract(epoch FROM (now() - (SELECT at FROM last_sync))) / 60)) AS detail
         WHERE (SELECT at FROM last_sync) IS NULL
            OR (SELECT at FROM last_sync) < now() - interval '20 minutes'

        UNION ALL
        -- Runs are succeeding AND failing. Something is contended or
        -- flapping, and the successes hide it from every other rule.
        SELECT 'sync_failing_intermittently', 'warning',
               jsonb_build_object(
                   'failed', failed, 'of', total,
                   'lastError', left(coalesce(last_error, ''), 160))
          FROM recent
         WHERE total >= 10 AND failed >= 3

        UNION ALL
        SELECT 'writes_dead_lettered', 'critical',
               jsonb_build_object(
                   'count', count(*),
                   'workOrders', jsonb_agg(DISTINCT wo_code),
                   'oldest', min(updated_at))
          FROM onkey_outbox WHERE state = 'dead_letter'
        HAVING count(*) > 0

        UNION ALL
        SELECT 'writes_failing', 'warning',
               jsonb_build_object(
                   'count', count(*),
                   'workOrders', jsonb_agg(DISTINCT wo_code))
          FROM onkey_outbox
         WHERE state = 'failed' AND attempts >= 3
        HAVING count(*) > 0

        UNION ALL
        SELECT 'writes_blocked', 'info',
               jsonb_build_object(
                   'count', count(*),
                   'reasons', jsonb_agg(DISTINCT left(coalesce(last_error, 'unknown'), 80)))
          FROM onkey_outbox WHERE state = 'blocked'
        HAVING count(*) > 0

        UNION ALL
        SELECT 'divergence_unacknowledged', 'warning',
               jsonb_build_object('count', count(*))
          FROM wo_divergence WHERE acknowledged_at IS NULL
        HAVING count(*) > 0

        UNION ALL
        SELECT 'cron_failing', 'critical',
               jsonb_build_object('jobs', jsonb_agg(DISTINCT jobname))
          FROM cron.job_run_details d
          JOIN cron.job j ON j.jobid = d.jobid
         WHERE d.status = 'failed' AND d.start_time > now() - interval '30 minutes'
        HAVING count(*) > 0
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'key', alert_key, 'severity', severity, 'detail', detail)
           ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
                    alert_key), '[]'::jsonb)
      FROM alerts;
$function$
;

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
    )
    SELECT coalesce(jsonb_agg(a), '[]'::jsonb) FROM merged;
$function$;
