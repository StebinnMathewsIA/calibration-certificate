-- A generic invoker for the OnKey Edge Function, so an export can be run
-- with parameters from SQL instead of needing a new kick function per
-- report. Same secret resolution as onkey_drain_kick (migration 048), and
-- the same asynchronous pg_net semantics: this returns a request id, and
-- the answer lands in net._http_response.
--
-- Not granted to anyone. It is an operator tool, called from the SQL
-- editor or from another SECURITY DEFINER function.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION onkey_function_call(p_body jsonb, p_timeout_ms int DEFAULT 120000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    secret text;
    base   text;
    req_id bigint;
BEGIN
    SELECT decrypted_secret INTO secret
      FROM vault.decrypted_secrets WHERE name = 'onkey_function_secret';
    IF coalesce(secret, '') = '' THEN
        SELECT decrypted_secret INTO secret
          FROM vault.decrypted_secrets WHERE name = 'onkey_sync_token';
    END IF;
    IF coalesce(secret, '') = '' THEN
        RETURN jsonb_build_object(
            'called', false,
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
        body := p_body,
        timeout_milliseconds := p_timeout_ms
    ) INTO req_id;

    RETURN jsonb_build_object('called', true, 'requestId', req_id);
END $$;

REVOKE ALL ON FUNCTION onkey_function_call(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION onkey_function_call(jsonb, int) FROM anon, authenticated;
