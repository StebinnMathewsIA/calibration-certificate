-- 119: the shadow lane moves off the delta lane's minutes (#180).
--
-- Morning findings, first shadow night: every row the windowed recent
-- lane inserted was either during the delta lane's one-off overnight
-- curfew, or at a :00 mark where both lanes fire in the same minute and
-- the recent lane happened to win the lease race. Neither is a delta
-- miss, but both muddy the signal the shadow exists to produce, namely
-- "the windowed lane inserts nothing the delta lane did not already
-- have". Offsetting the recent lane to the :05 marks removes the
-- collisions; replaying 118 alongside restores the delta lane's full
-- schedule after its one-night curfew.

DO $$
DECLARE
    j record;
BEGIN
    FOR j IN
        SELECT * FROM (VALUES
            ('onkey-sync-recent', '5-55/10 * * * *',
             'SELECT onkey_sync_kick_guarded(''recent'')')
        ) AS t(jobname, schedule, command)
    LOOP
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j.jobname;
        PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    END LOOP;
END $$;
