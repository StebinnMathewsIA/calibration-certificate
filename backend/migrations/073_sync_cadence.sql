-- The sync cannot finish inside its own interval (#117, root cause).
--
-- Measured over two hours of successful runs:
--
--   recent sync   avg 76 s, max 93 s   fired every 60 s
--   drain         avg  0 s, max  2 s
--   export        avg  4 s, max 15 s
--
-- So the every-minute sync OVERLAPS ITSELF, permanently. A run starting at
-- 12:01 is still holding a session when 12:02 fires. That is why E0104 was
-- constant rather than occasional, and why anything else that needed a
-- session failed alongside it. Staggering the other jobs (migration 062)
-- helped them avoid each other and could not fix this, because the sync was
-- colliding with its own previous run.
--
-- Every two minutes, and the drain in the gap between. Freshness goes from
-- a nominal 1 minute that failed about half the time to a real 2 minutes,
-- which is worse on paper and much better in practice.
--
-- Idempotent.

DO $$
BEGIN
    -- Even minutes. 76 s average leaves comfortable headroom in 120 s, and
    -- the 93 s worst case still lands before the next fire.
    PERFORM cron.unschedule('onkey-sync-recent')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-recent');
    PERFORM cron.schedule('onkey-sync-recent', '*/2 * * * *',
        $cron$SELECT onkey_sync_kick_guarded('recent')$cron$);

    -- Odd minutes, so it can never be inside a sync run. The drain takes
    -- under two seconds, so it is out of the way long before the next sync.
    PERFORM cron.unschedule('onkey-drain')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-drain');
    PERFORM cron.schedule('onkey-drain', '1-59/2 * * * *',
        $cron$SELECT onkey_drain_kick_guarded()$cron$);

    -- Seeding reads our own mirror and never touches OnKey, so it stays on
    -- the minute and no longer sleeps to get out of the way.
    PERFORM cron.unschedule('wo-seed-from-onkey')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wo-seed-from-onkey');
    PERFORM cron.schedule('wo-seed-from-onkey', '* * * * *',
        $cron$SELECT wo_seed_from_onkey_guarded()$cron$);
END $$;

/** The lease has to outlive the work it protects, and the work takes 76 s.
 * At 50 s it expired mid-run and let the next job think the coast was
 * clear. */
CREATE OR REPLACE FUNCTION onkey_sync_kick_guarded(p_mode text DEFAULT 'incremental')
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    result jsonb;
BEGIN
    IF NOT onkey_take_session_lease('sync:' || p_mode, 115) THEN
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

REVOKE ALL ON FUNCTION onkey_sync_kick_guarded(text) FROM anon, authenticated;
