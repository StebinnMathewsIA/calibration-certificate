-- Schedule the Syspro stock load (#142).
--
-- CADENCE, from measurement rather than taste:
--
--   incremental, nothing changed    ~2 s     every 10 minutes
--   full load, everything           36 s     nightly at 02:47 SAST
--
-- Ten minutes, not one. An idle incremental pull is cheap for us and it
-- is still a scan of somebody else's production inventory table, since
-- TimeStamp is not indexed. Six an hour is responsive enough for stock
-- that moves when a storeman loads a van, and 144 scans a day rather
-- than 1,440 is the difference between a good neighbour and a bad one.
-- Nothing we do changes these numbers between loads anyway: our job cards
-- book parts to OnKey, not to Syspro.
--
-- The full load is what catches DELETIONS. A rowversion cannot see one,
-- because the deleted row takes its rowversion with it, so incremental
-- alone would let a withdrawn line sit on a van for ever.
--
-- OFF-PEAK AND OFF-BEAT. The nightly full load sits at 02:47, away from
-- the 02:17 to 02:41 block of OnKey refreshes, and the incremental runs
-- on minute 5 of each ten so it never starts on the same tick as the
-- two-minutely OnKey sync. The backend has 512 MB and overruns it when
-- two exports overlap (#134); this does not fix that, it just declines
-- to make it worse.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION syspro_load_kick(p_mode text DEFAULT 'incremental')
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
    IF p_mode NOT IN ('full', 'incremental') THEN
        RETURN jsonb_build_object('kicked', false, 'reason', 'unknown mode ' || p_mode);
    END IF;

    SELECT decrypted_secret INTO token
      FROM vault.decrypted_secrets WHERE name = 'onkey_sync_token';
    SELECT decrypted_secret INTO base
      FROM vault.decrypted_secrets WHERE name = 'onkey_api_base_url';
    base := coalesce(nullif(base, ''), 'https://prowalco-calibration-api.onrender.com');

    IF coalesce(token, '') = '' THEN
        -- Deliberately not an exception. A missing secret must not fill
        -- cron.job_run_details with failures, and whoever comes looking
        -- needs a readable reason rather than a stack trace.
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'vault secret onkey_sync_token is not set');
    END IF;

    SELECT net.http_post(
        url := base || '/v1/syspro/load?mode=' || p_mode,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || token,
            'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        -- Longer than the 36 s a full load takes, with room for a slow
        -- day on their server.
        timeout_milliseconds := 240000
    ) INTO req_id;

    RETURN jsonb_build_object('kicked', true, 'mode', p_mode, 'requestId', req_id);
END $function$;

DO $$
BEGIN
    PERFORM cron.unschedule('syspro-load-incremental')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'syspro-load-incremental');
    -- Minute 5 of every ten, so it never shares a tick with the
    -- two-minutely OnKey sync on the same 512 MB instance.
    PERFORM cron.schedule('syspro-load-incremental', '5-59/10 * * * *',
        $cron$SELECT syspro_load_kick('incremental')$cron$);

    PERFORM cron.unschedule('syspro-load-full')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'syspro-load-full');
    -- 02:47 SAST is 00:47 UTC, clear of the 02:17 to 02:41 OnKey refresh
    -- block and of anybody's working day.
    PERFORM cron.schedule('syspro-load-full', '47 0 * * *',
        $cron$SELECT syspro_load_kick('full')$cron$);
END $$;

/** Stock that has stopped refreshing, as an ops alert (#61).
 *
 * Said as a consequence rather than a system state: a technician acting
 * on a two-hour-old van figure is the actual problem, not the fact that
 * a cron job is quiet. Threshold is three missed incremental runs, so a
 * single blip does not page anybody. */
CREATE OR REPLACE FUNCTION syspro_stale_alert()
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN syspro_last_load() IS NULL THEN
            jsonb_build_object(
                'key', 'syspro_never_loaded',
                'severity', 'warning',
                'detail', jsonb_build_object('reason', 'stock has never been loaded from Syspro'))
        WHEN syspro_minutes_stale() > 35 THEN
            jsonb_build_object(
                'key', 'syspro_stale',
                'severity', 'warning',
                'detail', jsonb_build_object(
                    'minutesAgo', syspro_minutes_stale(),
                    'reason', 'van stock figures are no longer being refreshed'))
        ELSE NULL
    END;
$function$;
