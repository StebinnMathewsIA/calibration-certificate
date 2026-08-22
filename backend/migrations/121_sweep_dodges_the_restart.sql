-- 121: the sweep drops its 01:11 UTC slot (#194).
--
-- The #193 tombstones answered the question within two nights: sweeps
-- at the 14-day window complete in about 90 seconds, EXCEPT the 01:11
-- slot, which died on Aug 21 and Aug 22 alike, the fingerprint of the
-- free Render instance's fixed daily restart window landing on it. The
-- dying sweep also held the session lease through the roster's primary
-- 01:23 kick, exhausting its attempts and pushing the roster to the
-- 02:37 retry every night. Three slots a day are ample for a 90 second
-- correctness net, and the roster's first kick gets its lease back.

DO $$
DECLARE
    j record;
BEGIN
    FOR j IN
        SELECT * FROM (VALUES
            ('onkey-sync-sweep', '11 4,11,18 * * *',
             'SELECT onkey_kick_patient(''incremental'')')
        ) AS t(jobname, schedule, command)
    LOOP
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j.jobname;
        PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    END LOOP;
END $$;
