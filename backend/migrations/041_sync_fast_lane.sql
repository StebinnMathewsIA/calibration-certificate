-- 041_sync_fast_lane.sql
--
-- Make the work list as close to live as the interface allows.
--
-- Until now one pull did everything: a 35-day window, 65 columns, chunked
-- month by month, taking many minutes per run. Run every five minutes it
-- was mostly re-fetching rows that had not changed, and a technician on
-- site could still be several minutes behind the planner.
--
-- Split it into two lanes:
--
--   FAST (mode=recent, every minute): a two-day window. Small, quick, and
--   it carries every queue transition the planner has made today. This is
--   what the technician's work list rides on.
--
--   SWEEP (mode=incremental, hourly at minute 7): the existing 35-day
--   window. The narrow lane filters on the queue transition time, so a
--   change that moves only WorkOrderLastModifiedOn on an already-queued
--   work order can slip past it. The sweep catches those, and anything
--   the fast lane missed while the service was restarting.
--
-- The two have separate single-flight guards server-side, so an hour-long
-- sweep can never starve the once-a-minute lane.
--
-- Cost check before choosing one minute: the heaviest part of a derive,
-- the DISTINCT ON over the whole 31k-row snapshot, measures 230 ms. The
-- export itself is what takes time, and the narrow window keeps that
-- small. Overlapping runs are refused, not queued, so a slow minute
-- costs nothing.

DO $$
BEGIN
    -- Replace the single 5-minute kick from migration 040.
    PERFORM cron.unschedule('onkey-sync-kick')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-kick');

    PERFORM cron.unschedule('onkey-sync-recent')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-recent');
    PERFORM cron.schedule(
        'onkey-sync-recent', '* * * * *',
        $cron$SELECT onkey_sync_kick('recent')$cron$);

    PERFORM cron.unschedule('onkey-sync-sweep')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-sync-sweep');
    PERFORM cron.schedule(
        'onkey-sync-sweep', '7 * * * *',
        $cron$SELECT onkey_sync_kick('incremental')$cron$);
END $$;

-- The seed reads what the pull wrote, so at a one-minute pull cadence it
-- should follow at the same rate rather than lag up to five minutes. It
-- is pure SQL against tables already in memory.
DO $$
BEGIN
    PERFORM cron.unschedule('wo-seed-from-onkey')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wo-seed-from-onkey');
    PERFORM cron.schedule(
        'wo-seed-from-onkey', '* * * * *',
        $cron$SELECT wo_seed_from_onkey()$cron$);
END $$;
