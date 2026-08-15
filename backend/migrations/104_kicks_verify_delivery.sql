-- Scheduled kicks retry the lease AND verify delivery (#153).
--
-- Two silent failure modes found on 2026-08-15. The incremental sweep
-- fires at minute :11, when the :10 recent sync (80 to 97 seconds) always
-- still holds the single session lease: refused every time, "succeeded"
-- in pg_cron, no incremental since 08-14. And the roster kick posted into
-- a restarting service at 01:23, could not know (pg_net is asynchronous),
-- reported kicked=true, and its abandoned lease blocked the recent sync
-- for fifteen minutes.
--
-- One patient kick for every scheduled mode: retry the lease for up to
-- two minutes, then wait for the pg_net response and confirm the backend
-- actually accepted. Anything else releases the lease and says why. All
-- outcomes land in onkey_kick_log, because pg_cron's "1 row" tells
-- nobody anything.
--
-- Idempotent.

-- The lease functions must tell the time with clock_timestamp(), not
-- now(). now() is frozen at transaction start, and the patient kick is
-- one long transaction: with now() in the comparison, a kick that
-- started while the lease was held could never see a release that
-- happened after it started, so every retry was dead on arrival. That
-- is precisely how both overnight roster kicks "retried" twelve times
-- against a lease that had been free for most of that time.
CREATE OR REPLACE FUNCTION onkey_take_session_lease(p_holder text, p_seconds integer DEFAULT 50)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    taken boolean;
BEGIN
    INSERT INTO onkey_session_lease (id, holder, acquired_at, expires_at)
    VALUES (true, p_holder, clock_timestamp(),
            clock_timestamp() + make_interval(secs => p_seconds))
    ON CONFLICT (id) DO UPDATE
       SET holder = EXCLUDED.holder,
           acquired_at = EXCLUDED.acquired_at,
           expires_at = EXCLUDED.expires_at
     WHERE onkey_session_lease.expires_at < clock_timestamp()
    RETURNING true INTO taken;

    RETURN coalesce(taken, false);
END $function$;

CREATE OR REPLACE FUNCTION onkey_release_session_lease(p_holder text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    released boolean;
BEGIN
    UPDATE onkey_session_lease
       SET expires_at = clock_timestamp()
     WHERE id = true AND holder = p_holder AND expires_at > clock_timestamp()
    RETURNING true INTO released;
    RETURN coalesce(released, false);
END $function$;

CREATE TABLE IF NOT EXISTS onkey_kick_log (
    id bigserial PRIMARY KEY,
    mode text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onkey_kick_log_created_idx ON onkey_kick_log (created_at);
ALTER TABLE onkey_kick_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_kick_log FROM anon, authenticated;

-- The kick is a bounded FUNCTION and the delivery check is a SEPARATE
-- minutely job, and both halves of that split were forced by measurement:
--
-- 1. net.http_post only queues a request row, and the pg_net worker
--    cannot see it until the queuing transaction commits, so a kick
--    that waits for its own response inside one transaction waits for a
--    request that has not left the building. A procedure with COMMIT
--    was tried and hit the other wall:
-- 2. cron sessions carry a roughly two minute statement timeout that is
--    NOT reset by intra-CALL commits, and a patient retry loop plus a
--    response wait does not fit inside it. A cancelled kick rolls back
--    whole (lease take, queued request and all), which is at least
--    clean, but it is a lost firing.
--
-- So: the kick retries the lease within a budget that fits the timeout,
-- posts, logs itself pending, and returns. The verifier runs every
-- minute in its own fresh session, where the committed response is
-- plainly visible, resolves pending kicks, and releases the lease of
-- any kick whose request died or was refused, so a dead service can
-- never cost more than a few minutes of lease.
--
-- The retry sleeps are jittered, never fixed: the lease cycle is
-- exactly 120 seconds (recent takes it at every even minute, the drain
-- at every odd minute plus forty), and a fixed sleep phase-locks the
-- retries to the cycle. Measured: ten fixed 10-second attempts missed a
-- 15-second free window every time.
CREATE OR REPLACE FUNCTION onkey_kick_patient(p_mode text, p_max_attempts int DEFAULT 10)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    attempt int := 0;
    kick jsonb;
BEGIN
    LOOP
        attempt := attempt + 1;
        IF onkey_take_session_lease('sync:' || p_mode, onkey_sync_lease_seconds(p_mode)) THEN
            kick := onkey_sync_kick(p_mode);
            IF NOT coalesce((kick ->> 'kicked')::boolean, false) THEN
                -- Never queued (e.g. missing vault secret): nothing will
                -- run, so nothing may keep the lease.
                PERFORM onkey_release_session_lease('sync:' || p_mode);
                kick := kick || jsonb_build_object('attempts', attempt, 'delivered', false);
            ELSE
                -- Queued; the request leaves when this commits, and
                -- onkey_kick_verify() resolves the outcome.
                kick := kick || jsonb_build_object('attempts', attempt, 'pending', true);
            END IF;
            INSERT INTO onkey_kick_log (mode, result) VALUES (p_mode, kick);
            RETURN kick;
        END IF;

        IF attempt >= p_max_attempts THEN
            kick := jsonb_build_object(
                'kicked', false,
                'delivered', false,
                'attempts', attempt,
                'reason', 'the session lease stayed held');
            INSERT INTO onkey_kick_log (mode, result) VALUES (p_mode, kick);
            RETURN kick;
        END IF;
        PERFORM pg_sleep(6 + random() * 5);
    END LOOP;
END $function$;

/** Resolve pending kicks against pg_net's responses. Runs every minute
 * in its own session, which is the point: it sees what the kick's own
 * transaction never could. Releases the lease of a kick whose request
 * errored, was refused, or got no response within three minutes; the
 * holder check inside the release makes that safe against a lease that
 * has since legitimately changed hands. */
CREATE OR REPLACE FUNCTION onkey_kick_verify()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    r record;
    resp record;
    accepted boolean;
    body jsonb;
    outcome jsonb;
    resolved int := 0;
BEGIN
    FOR r IN
        SELECT id, mode, result, created_at
          FROM onkey_kick_log
         WHERE created_at > now() - interval '30 minutes'
           AND result ? 'pending'
    LOOP
        SELECT status_code, content, error_msg INTO resp
          FROM net._http_response
         WHERE id = (r.result ->> 'requestId')::bigint;

        IF FOUND THEN
            accepted := false;
            IF resp.status_code = 200 THEN
                BEGIN
                    body := resp.content::jsonb;
                    accepted := coalesce((body ->> 'accepted')::boolean, false);
                EXCEPTION WHEN others THEN
                    accepted := false;
                END;
            END IF;
            IF accepted THEN
                outcome := (r.result - 'pending') || jsonb_build_object('delivered', true);
            ELSE
                PERFORM onkey_release_session_lease('sync:' || r.mode);
                outcome := (r.result - 'pending') || jsonb_build_object(
                    'delivered', false,
                    'status', resp.status_code,
                    'detail', left(coalesce(resp.error_msg, resp.content, 'empty response'), 300));
            END IF;
        ELSIF r.created_at < now() - interval '3 minutes' THEN
            PERFORM onkey_release_session_lease('sync:' || r.mode);
            outcome := (r.result - 'pending') || jsonb_build_object(
                'delivered', false,
                'detail', 'no response after 3 minutes; pg_net may have dropped it');
        ELSE
            CONTINUE;  -- too fresh to judge; next minute decides
        END IF;

        UPDATE onkey_kick_log SET result = outcome WHERE id = r.id;
        resolved := resolved + 1;
    END LOOP;
    RETURN jsonb_build_object('resolved', resolved);
END $function$;

REVOKE ALL ON FUNCTION onkey_kick_patient(text, int) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_kick_verify() FROM anon, authenticated;
DROP PROCEDURE IF EXISTS onkey_kick_run(text, int);

-- The sweep and both roster jobs move onto the patient kick, and the
-- verifier joins the minutely rota. The old roster-only patient
-- function is superseded.
DO $$
BEGIN
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('onkey-sync-sweep', 'onkey-roster-sync',
                       'onkey-roster-sync-retry', 'onkey-kick-verify');
    PERFORM cron.schedule('onkey-sync-sweep', '11 1,4,11,18 * * *',
        $cron$SELECT onkey_kick_patient('incremental')$cron$);
    PERFORM cron.schedule('onkey-roster-sync', '23 1 * * *',
        $cron$SELECT onkey_kick_patient('roster')$cron$);
    PERFORM cron.schedule('onkey-roster-sync-retry', '37 2 * * *',
        $cron$SELECT onkey_kick_patient('roster')$cron$);
    PERFORM cron.schedule('onkey-kick-verify', '* * * * *',
        $cron$SELECT onkey_kick_verify()$cron$);
END $$;

DROP FUNCTION IF EXISTS onkey_roster_kick_patient();
