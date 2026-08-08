-- Give the drain a real gap to run in (#117, follow-up to 073).
--
-- 073 set the sync lease to 115 s to cover a 93 s worst case, and put the
-- drain on odd minutes. In a two-minute cycle that means the lease is held
-- from 0 s to 115 s and the drain fires at 60 s: inside it, every single
-- time. The drain ran on schedule, took the guard, was told the lease was
-- held, and returned without sending. A queued costing line sat pending for
-- seven minutes with dry_run off and nothing wrong with it.
--
-- Fixing the overlap starved the thing the overlap was blocking. The gap
-- has to be arranged, not assumed:
--
--   0 s    sync starts, lease held to 95 s
--   76 s   sync typically finishes (93 s worst case)
--   100 s  drain fires, lease free, takes under 2 s
--   120 s  next sync
--
-- 95 s still covers the measured worst case and leaves 25 s of clear air.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION onkey_sync_kick_guarded(p_mode text DEFAULT 'incremental')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    result jsonb;
BEGIN
    IF NOT onkey_take_session_lease('sync:' || p_mode, 95) THEN
        RETURN jsonb_build_object(
            'kicked', false,
            'reason', 'another OnKey job holds the session lease');
    END IF;
    result := onkey_sync_kick(p_mode);
    IF NOT coalesce((result ->> 'kicked')::boolean, false) THEN
        PERFORM onkey_release_session_lease('sync:' || p_mode);
    END IF;
    RETURN result;
END $function$;

/** The drain holds the lease for the two seconds it needs, not for a
 * minute. A long lease here would push the NEXT sync out, which is the
 * same starvation with the roles reversed. */
CREATE OR REPLACE FUNCTION onkey_drain_kick_guarded(p_limit int DEFAULT 25)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    result jsonb;
BEGIN
    IF NOT onkey_take_session_lease('drain', 15) THEN
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

DO $$
BEGIN
    PERFORM cron.unschedule('onkey-drain')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-drain');
    -- Odd minute plus 40 s, so 100 s into the two-minute cycle.
    PERFORM cron.schedule('onkey-drain', '1-59/2 * * * *',
        $cron$SELECT pg_sleep(40), onkey_drain_kick_guarded()$cron$);
END $$;

REVOKE ALL ON FUNCTION onkey_sync_kick_guarded(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_drain_kick_guarded(int) FROM anon, authenticated;
