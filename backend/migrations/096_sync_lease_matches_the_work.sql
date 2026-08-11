-- The session lease has to outlast the work it protects (#134).
--
-- THE DIAGNOSIS IN #134 WAS WRONG and is corrected here. It said the fix
-- was one lease across run kinds instead of one per kind. There was never
-- one per kind: onkey_session_lease is a single row, keyed
-- `id boolean PRIMARY KEY DEFAULT true`, and the holder is only a label.
--
-- The real mechanism is duller and worse. A second taker succeeds when
-- the current lease has EXPIRED, and the lease was 95 seconds while the
-- incremental sweep takes about 894. So the lease lapsed roughly 95
-- seconds into a fifteen-minute sweep and every two-minutely `recent`
-- job after that found the coast clear. That is how two OnKey exports
-- ended up in one 512 MB process, 233 times in 36 hours.
--
-- Nothing released the lease either. The kick fires an asynchronous HTTP
-- request and returns, so the lease was always held until the clock ran
-- out. That forced the duration to be a compromise: long enough to
-- protect the work would have stalled the pipeline after every fast run.
--
-- So two changes together, and neither works alone:
--
--   1. The backend releases the lease when the run ENDS (routers/onkey.py).
--   2. The duration becomes a genuine upper bound on the work rather than
--      a guess tuned to not stall things: 300 s for `recent` against a
--      168 s worst case, 1800 s for the sweep against 894 s average and
--      1563 s worst.
--
-- With the release in place, a long bound costs nothing on a normal run.
-- It only bites if the backend dies mid-sweep, which is exactly when
-- something should wait.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION onkey_sync_lease_seconds(p_mode text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $function$
    SELECT CASE p_mode
        WHEN 'recent' THEN 300
        WHEN 'incremental' THEN 1800
        WHEN 'backfill' THEN 3600
        ELSE 300
    END;
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
    IF NOT onkey_take_session_lease('sync:' || p_mode, onkey_sync_lease_seconds(p_mode)) THEN
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

-- The sweep moves off the working day.
--
-- Now that the lease genuinely covers the sweep, `recent` is BLOCKED for
-- as long as the sweep runs, about fifteen minutes. Hourly, that is a
-- quarter of every working hour with a stale work list, and a stale work
-- list is the thing technicians actually complain about.
--
-- The sweep is a safety net: a 35-day window catching changes the 2-day
-- window's date filter cannot see. It does not need to run hourly. Four
-- times a day, placed away from working hours and away from the Syspro
-- jobs, keeps the safety net without spending the day blocking the fast
-- lane.
DO $$
BEGIN
    PERFORM cron.unschedule('onkey-sync-sweep')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-sweep');
    -- 03:11, 06:11, 13:11 and 20:11 SAST (01:11, 04:11, 11:11, 18:11 UTC).
    -- The 13:11 one is over lunch, so the sweep that catches a morning
    -- reassignment still lands inside the working day.
    PERFORM cron.schedule('onkey-sync-sweep', '11 1,4,11,18 * * *',
        $cron$SELECT onkey_sync_kick_guarded('incremental')$cron$);
END $$;
