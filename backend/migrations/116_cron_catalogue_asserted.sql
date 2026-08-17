-- 116: the cron catalogue gets a source of truth (#175).
--
-- Every schedule below had only ever been set live against the
-- database, and on the night of the 16th the catalogue silently
-- reverted to an older generation: the recent lane minutely instead of
-- every two minutes, and the sweep hourly with the old unlogged direct
-- kick instead of the patient logged kick. Sixty-second recent runs on
-- a one-minute cadence hold the session lease continuously, which
-- starved both roster firings on the morning of the 17th.
--
-- This migration asserts the intended catalogue idempotently. It is
-- replayed on every push by the live-test workflow, so any future
-- drift heals at the next deploy instead of surfacing as a mystery.

DO $$
DECLARE
    j record;
BEGIN
    FOR j IN
        SELECT * FROM (VALUES
            -- The fast lane: every two minutes, NOT minutely. A recent
            -- run holds the lease for roughly a minute, so the two
            -- minute cadence is what leaves the free windows the
            -- patient kicks depend on (#153, #160).
            ('onkey-sync-recent',      '*/2 * * * *',
             'SELECT onkey_sync_kick_guarded(''recent'')'),
            -- The drain rides the odd minutes, posting at the :40 mark
            -- so it lands in the recent lane''s tail gap (#74).
            ('onkey-drain',            '1-59/2 * * * *',
             'SELECT pg_sleep(40), onkey_drain_kick_guarded()'),
            -- The wide sweep: four firings a day through the patient,
            -- logged kick (#153, #160).
            ('onkey-sync-sweep',       '11 1,4,11,18 * * *',
             'SELECT onkey_kick_patient(''incremental'')'),
            ('onkey-roster-sync',      '23 1 * * *',
             'SELECT onkey_kick_patient(''roster'')'),
            ('onkey-roster-sync-retry','37 2 * * *',
             'SELECT onkey_kick_patient(''roster'')'),
            ('onkey-kick-verify',      '* * * * *',
             'SELECT onkey_kick_verify()'),
            -- The nightly register refreshes keep their spread-out slots.
            ('onkey-statuses-refresh',     '17 2 * * *', 'SELECT onkey_statuses_refresh()'),
            ('onkey-transitions-refresh',  '23 2 * * *', 'SELECT onkey_status_transitions_refresh()'),
            ('onkey-importances-refresh',  '29 2 * * *', 'SELECT onkey_importances_refresh()'),
            ('onkey-reasons-refresh',      '35 2 * * *', 'SELECT onkey_reasons_refresh()'),
            ('onkey-observed-transitions', '41 2 * * *', 'SELECT onkey_observed_transitions_refresh()')
        ) AS t(jobname, schedule, command)
    LOOP
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j.jobname;
        PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    END LOOP;
END $$;
