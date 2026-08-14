-- The roster kick retries the lease instead of losing a fixed race (#149).
--
-- Measured on both nights: the kick fires at second :00, and at second
-- :00 of any odd minute the previous even-minute recent sync (76 to 100
-- seconds long) still holds the session lease. One attempt, refused,
-- politely recorded as success. Deterministic, twice a night.
--
-- So the roster kick gets its own function that tries for up to two
-- minutes, sleeping ten seconds between attempts. Holding a pg_cron
-- worker for up to two minutes twice a night is cheap; the drain already
-- holds one for forty seconds every two minutes all day.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION onkey_roster_kick_patient()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    attempt int := 0;
    result jsonb;
BEGIN
    LOOP
        attempt := attempt + 1;
        IF onkey_take_session_lease('sync:roster', onkey_sync_lease_seconds('roster')) THEN
            result := onkey_sync_kick('roster');
            IF NOT coalesce((result ->> 'kicked')::boolean, false) THEN
                PERFORM onkey_release_session_lease('sync:roster');
            END IF;
            RETURN result || jsonb_build_object('attempts', attempt);
        END IF;
        IF attempt >= 12 THEN
            RETURN jsonb_build_object(
                'kicked', false,
                'attempts', attempt,
                'reason', 'the session lease stayed held for two minutes');
        END IF;
        PERFORM pg_sleep(10);
    END LOOP;
END $function$;

DO $$
BEGIN
    PERFORM cron.unschedule(jobname) FROM cron.job
     WHERE jobname IN ('onkey-roster-sync', 'onkey-roster-sync-retry');
    PERFORM cron.schedule('onkey-roster-sync', '23 1 * * *',
        $cron$SELECT onkey_roster_kick_patient()$cron$);
    PERFORM cron.schedule('onkey-roster-sync-retry', '37 2 * * *',
        $cron$SELECT onkey_roster_kick_patient()$cron$);
END $$;
