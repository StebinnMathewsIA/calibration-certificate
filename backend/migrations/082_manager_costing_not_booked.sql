-- A manager's job card books nothing (#131).
--
-- Owner, 2026-08-11: "No, only technicians are qualified to execute." So a
-- person with no van does not book travel or labour either, not just
-- spares. Nothing from their job card reaches OnKey.
--
-- That changes the mechanism, not just the message. Queuing the costing
-- 'blocked' was right while the answer was unknown, because blocked means
-- "held, and one flip releases it". There is nothing to release here: the
-- answer is no, permanently, by design. A queue full of rows that will
-- never be sent is a queue nobody can read, and it shows up in the alerts
-- as work outstanding when there is none.
--
-- So nothing is queued. The reason is recorded ON THE JOB CARD, where it
-- belongs: it is a fact about this job, not a pipeline failure.
--
-- The job card still records and prints travel, labour and parts. That is
-- the record of what happened on site and it is true regardless of who
-- books it.
--
-- Idempotent.

ALTER TABLE work_order_job_cards
    ADD COLUMN IF NOT EXISTS costing_note text;

CREATE OR REPLACE FUNCTION app_job_card_sign(
    p_work_order_id uuid,
    p_client_name text,
    p_client_signature text,
    p_tech_signature text DEFAULT NULL,
    p_occurred_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    jc work_order_job_cards%ROWTYPE;
    lines jsonb;
    task onkey_work_tasks%ROWTYPE;
    warehouse text;
    no_van boolean;
    note text;
    queue_state text;
    queue_note text;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO jc FROM work_order_job_cards WHERE work_order_id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Complete the job card before signing'; END IF;
    IF jc.state = 'signed' THEN RAISE EXCEPTION 'This job card is already signed'; END IF;
    IF coalesce(trim(p_client_name), '') = '' THEN
        RAISE EXCEPTION 'The name of the person accepting the work is required';
    END IF;
    IF coalesce(trim(p_client_signature), '') = '' THEN
        RAISE EXCEPTION 'The client signature is required';
    END IF;
    IF coalesce(trim(jc.work_performed), '') = '' THEN
        RAISE EXCEPTION 'Describe the work performed before signing';
    END IF;

    lines := job_card_lines(p_work_order_id);
    SELECT * INTO task FROM job_card_task_for(w.external_ref);
    warehouse := costing_warehouse_for(w.staff_code);
    no_van := technician_has_no_van(w.staff_code);

    IF no_van THEN
        note := format(
            '%s has no van and does not book work: only technicians with vans do. Nothing on this job card was sent to OnKey. The travel, labour and parts recorded here are the record of the visit.',
            coalesce((SELECT name FROM onkey_technicians WHERE staff_code = w.staff_code),
                     w.staff_code));
    END IF;

    UPDATE work_order_job_cards SET
        client_name = trim(p_client_name),
        client_signature = p_client_signature,
        tech_signature = coalesce(p_tech_signature, tech_signature),
        state = 'signed',
        signed_at = coalesce(p_occurred_at, now()),
        signed_by = app_email(),
        costing_note = note,
        updated_at = now()
    WHERE work_order_id = p_work_order_id;

    -- Nothing is queued for someone who does not book work. Not blocked,
    -- not pending: absent, because there is no write to make.
    IF NOT no_van AND jsonb_array_length(lines) > 0 AND w.external_ref IS NOT NULL
       AND w.source = 'onkey' THEN
        IF task.task_id IS NULL THEN
            queue_state := 'blocked';
            queue_note := format(
                'no work task known for %s, so the costing has no parent to hang off; fetch tasks and release',
                w.external_ref);
        ELSIF warehouse IS NULL THEN
            queue_state := 'blocked';
            queue_note := format(
                'the van for staff code %s is not confirmed, and OnKey requires a warehouse on every costing line (E202189); confirm it in technician_warehouses and release',
                coalesce(w.staff_code, 'unknown'));
        ELSE
            queue_state := 'pending';
            queue_note := NULL;
        END IF;

        INSERT INTO onkey_outbox (
            kind, wo_code, work_order_id, seq, payload, state, last_error, created_by)
        VALUES ('work_task_spares', w.external_ref, p_work_order_id, 1,
                jsonb_build_object(
                    'lines', lines,
                    'taskId', task.task_id,
                    'taskCode', task.task_code,
                    'warehouseCode', warehouse,
                    'workPerformed', jc.work_performed),
                queue_state, queue_note, app_email());
    END IF;

    PERFORM app_wo_transition(p_work_order_id, 'sign_off', NULL, NULL, NULL, NULL, p_occurred_at);

    RETURN app_job_card_get(p_work_order_id);
END $function$;

/** Said before the client is waiting. For someone with no van this is a
 * statement about how the business works, not a warning about a fault, so
 * it does not read as something they can fix. */
CREATE OR REPLACE FUNCTION app_job_card_costing_note(p_work_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN technician_has_no_van(w.staff_code)
            THEN 'You have no van, so nothing on this job card is booked to OnKey: only technicians with vans book work. What you record here still goes on the job card as the record of the visit.'
        WHEN costing_warehouse_for(w.staff_code) IS NULL
            THEN 'Your van is not confirmed yet, so the costing will be held until the office confirms it.'
        ELSE NULL
    END
    FROM work_orders w WHERE w.id = p_work_order_id;
$function$;

-- Clear the rows held under the old, now-answered reason. They were never
-- going to be sent, and leaving them in the queue says otherwise.
DELETE FROM onkey_outbox
 WHERE kind = 'work_task_spares'
   AND state = 'blocked'
   AND (last_error ILIKE '%has no van%' OR created_by = 'probe: ImportWorkTaskSpares');

GRANT EXECUTE ON FUNCTION app_job_card_sign(uuid, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_costing_note(uuid) TO authenticated;
