-- Alerting on sync and write failure (#105).
--
-- Today every one of these fails silently. The minute-by-minute sync can
-- stop and the work list simply stops changing, which looks exactly like a
-- quiet day. A write can dead-letter and the office never learns that the
-- job it thinks is running was stopped two hours ago. Nobody is watching
-- cron.job_run_details.
--
-- ONE detector, in SQL, so the app, any future email or push channel, and
-- anyone opening the SQL editor all read the same definition of unhealthy.
-- The delivery channel is deliberately NOT decided here: alerts are
-- recorded and surfaced in-app now, and a notifier can be attached later
-- without touching the rules.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS ops_alert_log (
    id bigserial PRIMARY KEY,
    alert_key varchar(64) NOT NULL,
    severity varchar(16) NOT NULL,
    detail jsonb NOT NULL DEFAULT '{}',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    cleared_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ops_alert_log_open_idx
    ON ops_alert_log (alert_key) WHERE cleared_at IS NULL;
ALTER TABLE ops_alert_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ops_alert_log FROM anon, authenticated;

/** What is wrong right now. Empty means healthy.
 *
 * Thresholds are deliberately loose enough that a single slow run is not
 * an alert: an alert that cries wolf gets ignored, and an ignored alert is
 * worse than none because it is mistaken for coverage. */
CREATE OR REPLACE FUNCTION ops_alerts()
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
    alerts AS (
        -- The work list has stopped moving. Twenty minutes, not one: the
        -- sync runs every minute, so this is twenty consecutive misses and
        -- cannot be a blip.
        SELECT 'sync_stalled' AS alert_key, 'critical' AS severity,
               jsonb_build_object(
                   'lastSuccessAt', (SELECT at FROM last_sync),
                   'minutesAgo', round(extract(epoch FROM (now() - (SELECT at FROM last_sync))) / 60)) AS detail
         WHERE (SELECT at FROM last_sync) IS NULL
            OR (SELECT at FROM last_sync) < now() - interval '20 minutes'

        UNION ALL
        -- A write OnKey will never receive. This is the one that puts the
        -- office out of step with the technician, so it is critical at one
        -- occurrence.
        SELECT 'writes_dead_lettered', 'critical',
               jsonb_build_object(
                   'count', count(*),
                   'workOrders', jsonb_agg(DISTINCT wo_code),
                   'oldest', min(updated_at))
          FROM onkey_outbox WHERE state = 'dead_letter'
        HAVING count(*) > 0

        UNION ALL
        -- Retrying and not getting through. Not yet lost, but heading that
        -- way, and worth catching before it dead-letters.
        SELECT 'writes_failing', 'warning',
               jsonb_build_object(
                   'count', count(*),
                   'workOrders', jsonb_agg(DISTINCT wo_code))
          FROM onkey_outbox
         WHERE state = 'failed' AND attempts >= 3
        HAVING count(*) > 0

        UNION ALL
        -- We declined to send these. Legitimate (allowlist, or a builder
        -- that does not exist yet), but a queue nobody looks at becomes a
        -- queue nobody remembers, so it is surfaced as information.
        SELECT 'writes_blocked', 'info',
               jsonb_build_object(
                   'count', count(*),
                   'reasons', jsonb_agg(DISTINCT left(coalesce(last_error, 'unknown'), 80)))
          FROM onkey_outbox WHERE state = 'blocked'
        HAVING count(*) > 0

        UNION ALL
        -- The office moved a job the technician is holding, and nobody has
        -- acknowledged it.
        SELECT 'divergence_unacknowledged', 'warning',
               jsonb_build_object('count', count(*))
          FROM wo_divergence WHERE acknowledged_at IS NULL
        HAVING count(*) > 0

        UNION ALL
        -- A cron job that is failing is how the two alerts above stop
        -- firing, so it is checked directly rather than inferred.
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
$function$;

/** Record what is wrong, and close what no longer is. Run on a schedule so
 * there is a HISTORY: "it has been broken since 04:10" is a different
 * conversation from "it is broken now". */
CREATE OR REPLACE FUNCTION ops_alert_sweep()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    current_alerts jsonb := ops_alerts();
    open_keys text[];
BEGIN
    SELECT coalesce(array_agg(a ->> 'key'), ARRAY[]::text[])
      INTO open_keys
      FROM jsonb_array_elements(current_alerts) a;

    INSERT INTO ops_alert_log (alert_key, severity, detail)
    SELECT a ->> 'key', a ->> 'severity', a -> 'detail'
      FROM jsonb_array_elements(current_alerts) a
    ON CONFLICT (alert_key) WHERE cleared_at IS NULL
    DO UPDATE SET detail = EXCLUDED.detail,
                  severity = EXCLUDED.severity,
                  last_seen_at = now();

    UPDATE ops_alert_log
       SET cleared_at = now()
     WHERE cleared_at IS NULL
       AND NOT (alert_key = ANY (open_keys));

    RETURN jsonb_build_object('open', jsonb_array_length(current_alerts), 'alerts', current_alerts);
END $function$;

/** Role holders only. A technician cannot act on a stalled cron job and
 * should not be shown one. */
CREATE OR REPLACE FUNCTION app_ops_alerts()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM app_roles WHERE email = app_email()) THEN
        RETURN NULL;
    END IF;
    RETURN ops_alerts();
END $function$;

GRANT EXECUTE ON FUNCTION app_ops_alerts() TO authenticated;
REVOKE ALL ON FUNCTION ops_alerts() FROM anon, authenticated;
REVOKE ALL ON FUNCTION ops_alert_sweep() FROM anon, authenticated;

DO $$
BEGIN
    PERFORM cron.unschedule('ops-alert-sweep')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ops-alert-sweep');
    PERFORM cron.schedule('ops-alert-sweep', '*/5 * * * *', $cron$SELECT ops_alert_sweep()$cron$);
END $$;
