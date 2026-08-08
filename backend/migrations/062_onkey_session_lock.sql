-- Stop exhausting OnKey's concurrent session limit (#117).
--
-- Three cron jobs fired on the same `* * * * *` schedule and two of them
-- opened their own OnKey session in the same second. Whichever logged on
-- first won; the rest were refused with
--
--   E0104: Too many concurrent sessions exist.
--
-- every minute, continuously, and nobody noticed because the next minute
-- usually succeeded. The session pool is not ours alone: Prowalco's staff
-- and any other integration draw on it too, so this was our jobs denying
-- their people logins.
--
-- Two changes, both needed. Staggering alone would still collide whenever a
-- run overran its minute, and the lock alone would leave jobs queueing at
-- :00 for no reason.
--
-- Idempotent.

/** One OnKey session at a time, across every job and every ad-hoc call.
 *
 * pg_try_advisory_xact_lock, not the blocking form: a kick that cannot get
 * the lock should be SKIPPED, not queued. These run every minute, so a
 * skipped run costs sixty seconds of staleness while a queued one holds a
 * connection and arrives late anyway. The lock is transaction-scoped, so it
 * is released even if the caller raises.
 *
 * The key is an arbitrary constant; it only has to be the same everywhere. */
CREATE OR REPLACE FUNCTION onkey_session_lock()
RETURNS boolean
LANGUAGE sql
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT pg_try_advisory_xact_lock(4713291);
$function$;

REVOKE ALL ON FUNCTION onkey_session_lock() FROM anon, authenticated;

/** Wrap the kick so callers cannot forget the lock. Returns the same shape
 * as the underlying function, plus a skipped reason when it stands down. */
CREATE OR REPLACE FUNCTION onkey_sync_kick_guarded(p_mode text DEFAULT 'incremental')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT onkey_session_lock() THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'another OnKey job holds the session lock');
    END IF;
    RETURN onkey_sync_kick(p_mode);
END $function$;

CREATE OR REPLACE FUNCTION onkey_drain_kick_guarded(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT onkey_session_lock() THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'another OnKey job holds the session lock');
    END IF;
    RETURN onkey_drain_kick(p_limit);
END $function$;

CREATE OR REPLACE FUNCTION wo_seed_from_onkey_guarded()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    IF NOT onkey_session_lock() THEN
        RETURN jsonb_build_object('seeded', false, 'reason', 'session lock held');
    END IF;
    RETURN wo_seed_from_onkey();
END $function$;

REVOKE ALL ON FUNCTION onkey_sync_kick_guarded(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_drain_kick_guarded(int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION wo_seed_from_onkey_guarded() FROM anon, authenticated;

-- Stagger, so the lock is a backstop rather than the everyday mechanism.
-- pg_cron's finest granularity is the minute, so the separation is by
-- SECOND inside the job command: each still fires every minute, but the
-- three no longer start together.
DO $$
BEGIN
    PERFORM cron.unschedule('onkey-sync-recent')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-recent');
    PERFORM cron.schedule('onkey-sync-recent', '* * * * *',
        $cron$SELECT onkey_sync_kick_guarded('recent')$cron$);

    PERFORM cron.unschedule('wo-seed-from-onkey')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wo-seed-from-onkey');
    -- Seeding reads what the sync just wrote, so it belongs AFTER it, not
    -- racing it. Twenty seconds is comfortably longer than a sync run.
    PERFORM cron.schedule('wo-seed-from-onkey', '* * * * *',
        $cron$SELECT pg_sleep(20), wo_seed_from_onkey_guarded()$cron$);

    PERFORM cron.unschedule('onkey-drain')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-drain');
    PERFORM cron.schedule('onkey-drain', '* * * * *',
        $cron$SELECT pg_sleep(40), onkey_drain_kick_guarded()$cron$);

    PERFORM cron.unschedule('onkey-sync-sweep')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-sweep');
    PERFORM cron.schedule('onkey-sync-sweep', '7 * * * *',
        $cron$SELECT onkey_sync_kick_guarded('incremental')$cron$);
END $$;

/** A failure RATE, which the existing detector cannot see. sync_stalled
 * only fires after 20 minutes with no success at all, so the pattern we
 * actually had, one failure and one success every minute for weeks, was
 * invisible: there was always a recent success. */
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
$function$;

REVOKE ALL ON FUNCTION ops_alerts() FROM anon, authenticated;
