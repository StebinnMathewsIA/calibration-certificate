-- 040_sync_kick.sql
--
-- Drive the OnKey pull from pg_cron instead of GitHub Actions.
--
-- The sync workflow declares "*/5 * * * *" but GitHub does not honour it.
-- Measured over the two days to 2026-08-05 the scheduled runs actually
-- fired roughly every 1 to 3 hours: 15:34, 13:24, 11:45, 09:44, 07:07,
-- 04:23, 01:06 and so on. GitHub drops high-frequency schedules under
-- load, and there is no setting that changes it. So even with the export
-- itself repaired, the work list could be three hours behind while every
-- part looked healthy. A technician arriving on site would not see a job
-- reassigned to them that morning.
--
-- Supabase's pg_cron does honour the interval: wo-seed-from-onkey has run
-- on the exact five-minute boundary without a miss. Moving the trigger
-- here makes "current" mean current. The endpoint is single-flight, so
-- the GitHub cron can keep running alongside as the freshness monitor and
-- Render keep-alive; a duplicate kick is answered with "already running".
--
-- ONE MANUAL STEP: the sync token must be in Supabase Vault under the
-- name onkey_sync_token, holding the same value as ONKEY_SYNC_TOKEN on
-- Render. Add it in the dashboard (Project Settings, Vault); it is never
-- to be pasted into this repo or into chat. Until it is present the kick
-- is a no-op that says so, and nothing else changes.

CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION onkey_sync_kick(p_mode text DEFAULT 'incremental')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    token   text;
    base    text;
    req_id  bigint;
BEGIN
    SELECT decrypted_secret INTO token
      FROM vault.decrypted_secrets WHERE name = 'onkey_sync_token';
    SELECT decrypted_secret INTO base
      FROM vault.decrypted_secrets WHERE name = 'onkey_api_base_url';
    base := coalesce(nullif(base, ''), 'https://prowalco-calibration-api.onrender.com');

    IF coalesce(token, '') = '' THEN
        -- Deliberately not an exception: a missing secret must not fill
        -- cron.job_run_details with failures, and the reason has to be
        -- readable by whoever comes looking.
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'vault secret onkey_sync_token is not set');
    END IF;

    -- pg_net is asynchronous: this returns a request id, not a response.
    -- That is exactly right here, because /v1/onkey/sync now accepts and
    -- runs the pull in a background thread. Whether the pull SUCCEEDED is
    -- answered by onkey_sync_runs, not by this call.
    SELECT net.http_post(
        url := base || '/v1/onkey/sync?mode=' || p_mode,
        headers := jsonb_build_object(
            'Authorization', 'Bearer ' || token,
            'Content-Type', 'application/json'),
        body := '{}'::jsonb,
        timeout_milliseconds := 15000
    ) INTO req_id;

    RETURN jsonb_build_object('kicked', true, 'mode', p_mode, 'requestId', req_id);
END $$;

REVOKE ALL ON FUNCTION onkey_sync_kick(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onkey_sync_kick(text) FROM anon, authenticated;

-- Offset from wo-seed-from-onkey rather than sharing its boundary. The
-- seed reads what the pull wrote, and on 2026-08-05 it ran 22 seconds
-- ahead of the register update and so missed a whole cycle. Kicking at
-- minute 1, 6, 11 and so on leaves the next seed four minutes later,
-- comfortably past any pull observed so far.
DO $$
BEGIN
    PERFORM cron.unschedule('onkey-sync-kick')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-kick');
    PERFORM cron.schedule('onkey-sync-kick', '1-56/5 * * * *', $cron$SELECT onkey_sync_kick()$cron$);
END $$;
