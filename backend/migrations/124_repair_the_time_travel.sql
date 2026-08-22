-- 124_repair_the_time_travel.sql
--
-- The test suite's conftest replayed EVERY migration file against the
-- live database on every pytest run (the same replay-on-boot bug #150
-- removed from the deploy path, surviving in the test path). Since 122
-- added work_orders.is_calibration_override, that replay dies at 044:
-- the old stored app_visible_work_orders view was created before the
-- column existed, and 044's SELECT w.* now expands differently, so
-- CREATE OR REPLACE fails with a column-rename error. Every run since
-- then replays 001-043 and aborts, reverting app_my_sites to its
-- 021-era body, the technician picker to its pre-050 body, and the
-- sync crons to the retired every-minute cadence, while everything
-- after 043 stays wherever an earlier aborted run left it.
--
-- Repair, in two moves:
--
-- 1) Recreate the view fresh, so its stored column list matches what
--    SELECT w.* expands to today. The definition is 044's, verbatim.
DROP VIEW IF EXISTS app_visible_work_orders;
CREATE VIEW app_visible_work_orders AS
    SELECT w.*,
           s.technician_stage,
           l.state AS lifecycle_state
      FROM work_orders w
      LEFT JOIN onkey_statuses s ON s.code = w.status_code
      LEFT JOIN work_order_lifecycle l ON l.work_order_id = w.id
     WHERE (
             -- Allocated or later: what planning has actually given them.
             s.technician_stage IS NOT NULL
             -- Or work in hand, whatever the office has done to the
             -- status. Nothing vanishes from under someone mid-job.
             OR l.state IN ('on_the_way', 'started', 'paused')
           )
       AND (
             -- Finished work stays for the day only, cut at local
             -- midnight. A new day has a new plan.
             coalesce(s.technician_stage, 0) < app_wo_finished_stage()
             OR coalesce(l.signed_off_at, l.stopped_at, l.updated_at, w.updated_at)
                >= app_day_start()
           );

-- 2) Un-record 044 through 123 in the ledger. apply_migrations re-runs
--    them in order (it recomputes pending after every file), which lands
--    every function, view and cron schedule back on its newest
--    definition. The files are individually idempotent: the old replay
--    ran all of them daily for weeks. 044's view replay is now a no-op
--    because step 1 already stored the identical definition.
DELETE FROM schema_migrations
 WHERE filename >= '044' AND filename < '124';
