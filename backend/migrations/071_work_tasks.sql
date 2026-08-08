-- Work task mirror (#110, unblocks #99 and the job card costing).
--
-- Spares hang off a WORK TASK, not off the work order, so booking travel,
-- labour or parts needs the task id for that job. FIELDOPS - TASK can now
-- be read (the parser was discarding every row), but it caps at 5000 and
-- returns an arbitrary slice: a full pull covered 29 of our 1143 open work
-- orders and none of the test set. So tasks are fetched PER WORK ORDER,
-- on the report's own WorkOrderCode filter, and kept here.
--
-- One fetch per work order, cached. The docs record that every work order
-- has exactly one task in all 1006 sampled, and 489 of 500 are the DEFAULT
-- placeholder, so this is a small table and a cheap lookup.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_work_tasks (
    task_id bigint PRIMARY KEY,
    work_order_code varchar(64) NOT NULL,
    task_code varchar(64),
    task_description text,
    sequence_number int,
    is_complete boolean,
    completed_on timestamptz,
    inspection_passed boolean,
    last_modified_on timestamptz,
    fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onkey_work_tasks_wo_idx
    ON onkey_work_tasks (work_order_code, sequence_number);
ALTER TABLE onkey_work_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_work_tasks FROM anon, authenticated;

/** Fold whatever the export has left in the raw store into the mirror.
 * Runs after every fetch, and over the bulk rows we already hold. */
CREATE OR REPLACE FUNCTION onkey_work_tasks_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    touched int;
BEGIN
    INSERT INTO onkey_work_tasks (
        task_id, work_order_code, task_code, task_description, sequence_number,
        is_complete, completed_on, inspection_passed, last_modified_on, fetched_at)
    SELECT DISTINCT ON ((r.data ->> 'Id')::bigint)
           (r.data ->> 'Id')::bigint,
           r.data ->> 'ParentCode',
           r.data ->> 'TaskCode',
           r.data ->> 'TaskDescription',
           nullif(r.data ->> 'SequenceNumber', '')::int,
           (r.data ->> 'IsComplete') = 'true',
           nullif(r.data ->> 'CompletedOn', '')::timestamptz,
           (r.data ->> 'InspectionPassed') = 'true',
           nullif(r.data ->> 'LastModifiedOn', '')::timestamptz,
           now()
      FROM onkey_report_rows r
     WHERE r.report_code = 'FIELDOPS - TASK'
       AND coalesce(r.data ->> 'Id', '') <> ''
       AND coalesce(r.data ->> 'ParentCode', '') <> ''
     ORDER BY (r.data ->> 'Id')::bigint, r.last_seen_at DESC
    ON CONFLICT (task_id) DO UPDATE SET
        work_order_code = EXCLUDED.work_order_code,
        task_code = EXCLUDED.task_code,
        task_description = EXCLUDED.task_description,
        sequence_number = EXCLUDED.sequence_number,
        is_complete = EXCLUDED.is_complete,
        completed_on = EXCLUDED.completed_on,
        inspection_passed = EXCLUDED.inspection_passed,
        last_modified_on = EXCLUDED.last_modified_on,
        fetched_at = now();

    GET DIAGNOSTICS touched = ROW_COUNT;
    RETURN jsonb_build_object('tasks', touched);
END $function$;

/** The task a costing line hangs off. The first by sequence, because every
 * work order sampled had exactly one and a tie has to break somewhere. */
CREATE OR REPLACE FUNCTION job_card_task_for(p_wo_code text)
RETURNS onkey_work_tasks
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT * FROM onkey_work_tasks
     WHERE work_order_code = p_wo_code
     ORDER BY coalesce(sequence_number, 0), task_id
     LIMIT 1;
$function$;

/** Ask the Edge Function for one work order's tasks.
 *
 * The code is escaped for T-SQL LIKE before it goes: the report filter is
 * "Is Like", and a bracket starts a character class there, so
 * `[TEST]#7067567` means "one character from T, E or S followed by
 * #7067567" and matches nothing, with no error. The literal form is
 * `[[]TEST]#7067567`. */
CREATE OR REPLACE FUNCTION onkey_fetch_tasks(p_wo_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    escaped text;
BEGIN
    IF coalesce(p_wo_code, '') = '' THEN
        RETURN jsonb_build_object('called', false, 'reason', 'no work order code');
    END IF;
    escaped := replace(p_wo_code, '[', '[[]');
    RETURN onkey_function_call(jsonb_build_object(
        'action', 'export',
        'reportCode', 'FIELDOPS - TASK',
        'maxRecords', 50,
        'refreshTasks', true,
        'parameters', jsonb_build_object(
            'StartDate', '2000-01-01T00:00:00',
            'EndDate', '2099-12-31T23:00:00',
            'WorkOrderCode', escaped)), 45000);
END $function$;

REVOKE ALL ON FUNCTION onkey_work_tasks_refresh() FROM anon, authenticated;
REVOKE ALL ON FUNCTION job_card_task_for(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_fetch_tasks(text) FROM anon, authenticated;

SELECT onkey_work_tasks_refresh();
