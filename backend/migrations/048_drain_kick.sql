-- 048_drain_kick.sql
--
-- Drive the outbox drain from pg_cron, the same way the sync pull is
-- driven (migration 040). No new secret is needed: the Edge Function
-- accepts x-onkey-secret matching ONKEY_FUNCTION_SECRET or, failing that,
-- ONKEY_SYNC_TOKEN, and the Vault already holds onkey_sync_token.
--
-- Every minute, because the whole point of writing status as it happens is
-- that the office sees a job start without phoning anyone. While dry_run
-- is on this costs nothing but a log line, and the function returns
-- immediately when the queue is empty.

CREATE OR REPLACE FUNCTION onkey_drain_kick(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    secret text;
    base   text;
    req_id bigint;
    pending int;
BEGIN
    -- Cheap guard: an empty queue is the common case, and there is no
    -- reason to wake a function to be told so.
    SELECT count(*) INTO pending
      FROM onkey_outbox
     WHERE state IN ('pending', 'failed')
       AND (not_before IS NULL OR not_before <= now());
    IF pending = 0 THEN
        RETURN jsonb_build_object('kicked', false, 'reason', 'nothing queued');
    END IF;

    SELECT decrypted_secret INTO secret
      FROM vault.decrypted_secrets WHERE name = 'onkey_function_secret';
    IF coalesce(secret, '') = '' THEN
        SELECT decrypted_secret INTO secret
          FROM vault.decrypted_secrets WHERE name = 'onkey_sync_token';
    END IF;
    IF coalesce(secret, '') = '' THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'no vault secret (onkey_function_secret or onkey_sync_token)');
    END IF;

    SELECT decrypted_secret INTO base
      FROM vault.decrypted_secrets WHERE name = 'onkey_function_url';
    base := coalesce(nullif(base, ''),
                     'https://pkaadtgmdouuhgrcshft.supabase.co/functions/v1/onkey');

    SELECT net.http_post(
        url := base,
        headers := jsonb_build_object(
            'x-onkey-secret', secret,
            'Content-Type', 'application/json'),
        body := jsonb_build_object('action', 'drain', 'limit', p_limit),
        timeout_milliseconds := 30000
    ) INTO req_id;

    RETURN jsonb_build_object('kicked', true, 'pending', pending, 'requestId', req_id);
END $$;

REVOKE ALL ON FUNCTION onkey_drain_kick(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION onkey_drain_kick(int) FROM anon, authenticated;

DO $$
BEGIN
    PERFORM cron.unschedule('onkey-drain')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-drain');
    PERFORM cron.schedule('onkey-drain', '* * * * *', $cron$SELECT onkey_drain_kick()$cron$);
END $$;
