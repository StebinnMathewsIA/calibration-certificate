-- 042_technician_stages.sql
--
-- Owner decisions, 2026-08-05:
--   1. A technician's phone holds ONLY their own work orders.
--   2. They should see work the planning team has actually given them:
--      Allocated and later, not To be Planned.
--   3. The list is ordered by where the job sits in its lifecycle.
--   4. Completed work stays for the day only. "A new day has a new plan."
--
-- Ordering needs an explicit ordinal because OnKey's status register has
-- no sequence of its own: onkey_statuses gives a code, a description and
-- a base status, and onkey_status_transitions gives a graph, not a line.
-- technician_stage is that ordinal. NULL means the status is not the
-- technician's business, which is most of the register.
--
-- Stage numbers are spaced by ten so a status can be slotted between two
-- existing ones without renumbering (an En Route status, if Prowalco adds
-- one, belongs at 15).

ALTER TABLE onkey_statuses ADD COLUMN IF NOT EXISTS technician_stage smallint;

COMMENT ON COLUMN onkey_statuses.technician_stage IS
    'Position in the technician''s job lifecycle, lower is earlier. NULL '
    'means the status is not shown on a technician''s work list.';

UPDATE onkey_statuses SET technician_stage = NULL;

UPDATE onkey_statuses SET technician_stage = v.stage
  FROM (VALUES
    ('ALC',  10),   -- Allocated: planning has given it to this technician
    ('WOR',  20),   -- Work Order Received: the technician has accepted it
    ('WRE',  30),   -- Work Resumed
    ('WPA',  40),   -- Work Paused
    ('LSI',  50),   -- Incomplete for Spares: waiting on parts
    ('SCTD', 55),   -- SCT Despatched: parts on the way
    ('DIS',  60),   -- WO Documents Outstanding: work done, paperwork owed
    ('WST',  70),   -- Work Stopped: finished on site
    ('WOS',  80),   -- Work Order Signed
    ('WSM',  90)    -- Work Submitted
  ) AS v(code, stage)
 WHERE onkey_statuses.code = v.code;

-- Deliberately NOT given a stage, with the reason, so the next person does
-- not have to guess whether the omission was considered:
--   TBP  To be Planned    planning has not assigned it yet
--   APR  Approved         approved but not allocated
--   TUA  Temp UnAllocated pulled back from a technician
--   TBC  To Be Cancelled  on its way out, not work to do
--   everything outside base status Approved (Completed, Closed, Cancelled,
--   Awaiting Approval) is finished or not yet real work.

-- Anything at this stage or later is finished on site, and falls under the
-- day rule rather than staying on the list indefinitely.
CREATE OR REPLACE FUNCTION app_wo_finished_stage() RETURNS smallint
LANGUAGE sql IMMUTABLE AS $$ SELECT 70::smallint $$;

-- Local midnight, not UTC midnight. A technician in Johannesburg finishing
-- at 21:00 would otherwise watch the job vanish at 02:00 their time.
CREATE OR REPLACE FUNCTION app_day_start() RETURNS timestamptz
LANGUAGE sql STABLE AS $$
    SELECT date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg')
           AT TIME ZONE 'Africa/Johannesburg'
$$;

CREATE OR REPLACE FUNCTION app_wo_list()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(
        app_wo_row(w)
        ORDER BY s.technician_stage NULLS LAST, w.complete_by NULLS LAST), '[]'::jsonb)
    FROM work_orders w
    LEFT JOIN onkey_statuses s ON s.code = w.status_code
    LEFT JOIN work_order_lifecycle l ON l.work_order_id = w.id
    WHERE app_staff_code() IS NOT NULL
      AND w.staff_code = app_staff_code()
      AND (
            s.technician_stage IS NOT NULL
            -- A job the technician is actually working stays on the list
            -- whatever the office has done to its status. Nothing vanishes
            -- from under someone with time logged against it.
            OR l.state IN ('started', 'paused')
          )
      AND (
            coalesce(s.technician_stage, 0) < app_wo_finished_stage()
            OR coalesce(l.signed_off_at, l.stopped_at, l.updated_at, w.updated_at)
               >= app_day_start()
          )
$function$;

-- The app groups and orders by stage, so it has to travel with the row.
-- Everything else here is unchanged from migration 033.
CREATE OR REPLACE FUNCTION app_wo_row(w work_orders)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
    SELECT jsonb_build_object(
        'id', w.id,
        'source', w.source,
        'externalRef', w.external_ref,
        'staffCode', w.staff_code,
        'siteId', w.site_id,
        'siteName', w.site_name,
        'customerName', w.customer_name,
        'assetCode', w.asset_code,
        'assetDescription', w.asset_description,
        'workRequired', w.work_required,
        'statusCode', w.status_code,
        'statusDescription', w.status_description,
        'statusStage', (SELECT s.technician_stage FROM onkey_statuses s
                        WHERE s.code = w.status_code),
        'importanceCode', w.importance_code,
        'importanceDescription', (SELECT i.description FROM onkey_importances i
                                  WHERE i.code = w.importance_code),
        'importanceWeight', (SELECT i.weight FROM onkey_importances i
                             WHERE i.code = w.importance_code),
        'estimatedDurationMinutes', w.estimated_duration_minutes,
        'completeBy', to_char(w.complete_by AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'requiredBy', to_char(w.required_by AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'gpsLocation', w.gps_location,
        'isDemo', w.is_demo,
        'lifecycle', (
            SELECT jsonb_build_object(
                'state', coalesce(l.state, 'not_started'),
                'pauseReason', l.pause_reason,
                'pauseNote', l.pause_note,
                'blocksResume', coalesce(r.blocks_resume, false),
                'startedAt', to_char(l.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedAt', to_char(l.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'stoppedAt', to_char(l.stopped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedSeconds', coalesce(l.paused_seconds, 0))
            FROM work_order_lifecycle l
            LEFT JOIN work_order_pause_reasons r ON r.code = l.pause_reason
            WHERE l.work_order_id = w.id))
$function$;
