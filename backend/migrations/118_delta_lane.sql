-- 118: the probe-then-fetch delta lane rides every two minutes (#180).
--
-- The owner authored two Analyser reports in OnKey: FIELDOPS - PROBE
-- (one row: the max work order and queue LastModifiedOn plus a total
-- count) and FIELDOPS - WOE DELTA (FIELDOPS - WOE with the date window
-- replaced by "modified since @Since" on either timestamp). The backend
-- probes the watermark and only exports when it moved, so near-live
-- freshness costs one one-row query per idle cycle instead of an 870
-- row export.
--
-- The recent lane stays at its 10 minute cadence (migration 117) as the
-- shadow validator: while the delta lane is healthy, the windowed lane
-- should insert nothing. Once a day of shadow running proves that, the
-- recent cadence can be relaxed further or the lane retired to the
-- sweep's role.

DO $$
DECLARE
    j record;
BEGIN
    FOR j IN
        SELECT * FROM (VALUES
            ('onkey-sync-delta', '*/2 * * * *',
             'SELECT onkey_sync_kick_guarded(''delta'')')
        ) AS t(jobname, schedule, command)
    LOOP
        PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = j.jobname;
        PERFORM cron.schedule(j.jobname, j.schedule, j.command);
    END LOOP;
END $$;
