-- 117: the sync cadence matches the data's change rate (#179).
--
-- Seven-day profile of the recent lane at the 2-minute cadence: 2,895
-- runs, 78 seconds each, 870 rows fetched per run, 4 rows inserted per
-- run. The lane spent 99.5 percent of its work re-fetching unchanged
-- data thirty times an hour, and wo-seed / wo-reconcile polled every
-- minute against tables that only change when a sync lands. On the
-- Nano compute tier this constant load burned the burstable CPU
-- credits around the clock, which is what starved the working-day
-- field tests of Aug 18 and 19 (recent lane down, app on stale cache).
--
-- New cadence: OnKey is polled every 10 minutes; the seed runs 3
-- minutes after each poll so a new work order still reaches the app in
-- the same cycle it arrives; reconcile follows at 5 past; the alert
-- sweep drops to quarter-hourly. Drain, roster, sweep and the nightly
-- refreshes are untouched. Asserted idempotently like migration 116,
-- so the catalogue self-heals on every deploy.

DO $$
DECLARE
    j record;
BEGIN
    FOR j IN
        SELECT * FROM (VALUES
            ('onkey-sync-recent',  '*/10 * * * *',
             'SELECT onkey_sync_kick_guarded(''recent'')'),
            ('wo-seed-from-onkey', '3-59/10 * * * *',
             'SELECT wo_seed_from_onkey_guarded()'),
            ('wo-reconcile',       '5-59/10 * * * *',
             'SELECT wo_reconcile()'),
            ('ops-alert-sweep',    '*/15 * * * *',
             'SELECT ops_alert_sweep()')
        ) AS t(jobname, schedule, command)
    LOOP
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j.jobname;
        PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    END LOOP;
END $$;
