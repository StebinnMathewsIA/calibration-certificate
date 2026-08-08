-- Correct the session guard from migration 062 (#117).
--
-- 062 used pg_try_advisory_xact_lock. That was wrong and would have looked
-- solved while doing nothing. The kick functions call net.http_post, which
-- is ASYNCHRONOUS: the transaction commits and drops the lock in
-- milliseconds, long before the HTTP request is made and OnKey is asked for
-- a session. Two kicks a second apart would both have taken the lock
-- happily and both have logged on.
--
-- A lock cannot span the gap because the work happens outside the
-- transaction that took it. A LEASE can: it is a row with an expiry, so it
-- survives the commit and lapses on its own if whoever took it never comes
-- back. Nothing has to be released for the system to recover.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_session_lease (
    id boolean PRIMARY KEY DEFAULT true CHECK (id),
    holder varchar(64) NOT NULL,
    acquired_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL
);
ALTER TABLE onkey_session_lease ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_session_lease FROM anon, authenticated;

/** Take the OnKey session lease, or report that someone else holds it.
 *
 * The default of 50 seconds is chosen against the observed run times: a
 * 'recent' sync takes about 65 seconds at its longest and the jobs fire
 * every minute, so a lease much shorter would let the next minute's job
 * start on top of a run still in progress, and one much longer would leave
 * the pipeline idle after a fast run. It is a bound on damage, not a
 * promise: an overrunning run can still be joined, which is why the
 * schedules are staggered as well. */
CREATE OR REPLACE FUNCTION onkey_take_session_lease(
    p_holder text,
    p_seconds int DEFAULT 50)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    taken boolean;
BEGIN
    INSERT INTO onkey_session_lease (id, holder, acquired_at, expires_at)
    VALUES (true, p_holder, now(), now() + make_interval(secs => p_seconds))
    ON CONFLICT (id) DO UPDATE
       SET holder = EXCLUDED.holder,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
     WHERE onkey_session_lease.expires_at < now()
    RETURNING true INTO taken;

    RETURN coalesce(taken, false);
END $function$;

/** Hand the lease back early, so the next job does not wait out the clock
 * after a run that finished in two seconds. Only the holder may release it:
 * a late finisher must not free a lease someone else has since taken. */
CREATE OR REPLACE FUNCTION onkey_release_session_lease(p_holder text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    UPDATE onkey_session_lease
       SET expires_at = now()
     WHERE holder = p_holder AND expires_at > now()
    RETURNING true;
$function$;

CREATE OR REPLACE FUNCTION onkey_sync_kick_guarded(p_mode text DEFAULT 'incremental')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    result jsonb;
BEGIN
    IF NOT onkey_take_session_lease('sync:' || p_mode) THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'another OnKey job holds the session lease');
    END IF;
    result := onkey_sync_kick(p_mode);
    -- A kick that never went out must not hold the lease for 50 seconds.
    IF NOT coalesce((result ->> 'kicked')::boolean, false) THEN
        PERFORM onkey_release_session_lease('sync:' || p_mode);
    END IF;
    RETURN result;
END $function$;

CREATE OR REPLACE FUNCTION onkey_drain_kick_guarded(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    result jsonb;
BEGIN
    IF NOT onkey_take_session_lease('drain') THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'another OnKey job holds the session lease');
    END IF;
    result := onkey_drain_kick(p_limit);
    IF NOT coalesce((result ->> 'kicked')::boolean, false) THEN
        PERFORM onkey_release_session_lease('drain');
    END IF;
    RETURN result;
END $function$;

/** Seeding reads our own mirror, it does not talk to OnKey, so it needs no
 * lease. 062 guarded it anyway, which would have made it skip runs for no
 * reason and quietly delay the work list. */
CREATE OR REPLACE FUNCTION wo_seed_from_onkey_guarded()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    RETURN wo_seed_from_onkey();
END $function$;

/** Ad-hoc exports go through the same lease, because an operator running a
 * report probe is exactly what pushed us over the limit and made every
 * export return E0104. */
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
    IF NOT onkey_take_session_lease('adhoc', 120) THEN
        RETURN jsonb_build_object(
            'called', false,
            'reason', 'another OnKey job holds the session lease; try again shortly');
    END IF;

    SELECT decrypted_secret INTO secret
      FROM vault.decrypted_secrets WHERE name = 'onkey_function_secret';
    IF coalesce(secret, '') = '' THEN
        SELECT decrypted_secret INTO secret
          FROM vault.decrypted_secrets WHERE name = 'onkey_sync_token';
    END IF;
    IF coalesce(secret, '') = '' THEN
        PERFORM onkey_release_session_lease('adhoc');
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

REVOKE ALL ON FUNCTION onkey_take_session_lease(text, int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_release_session_lease(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_function_call(jsonb, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION onkey_function_call(jsonb, int) FROM anon, authenticated;

DROP FUNCTION IF EXISTS onkey_session_lock();
