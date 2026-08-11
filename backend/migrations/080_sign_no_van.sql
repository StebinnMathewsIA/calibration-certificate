-- Sign-off when the technician has no van (#131).
--
-- Spares are the only lines affected. A person with no van holds no stock,
-- so there is nothing for them to issue, and the held reason has to say
-- that rather than "no verified van", which reads as a system fault about
-- a fact that is simply true.
--
-- The parts stay ON THE JOB CARD and on the printed document. They were
-- fitted; whose stock they came from is a costing question, not a question
-- about what happened on site.
--
-- OPEN QUESTION, deliberately not guessed (#131): travel and labour go
-- through the same OnKey table with the same ItemType 0, so they need a
-- warehouse too. Whether a manager's travel and labour book anywhere at
-- all, and against what, is the owner's to answer. Until then the whole
-- costing holds for a vanless technician, which is visible and safe.
--
-- Idempotent.

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

    UPDATE work_order_job_cards SET
        client_name = trim(p_client_name),
        client_signature = p_client_signature,
        tech_signature = coalesce(p_tech_signature, tech_signature),
        state = 'signed',
        signed_at = coalesce(p_occurred_at, now()),
        signed_by = app_email(),
        updated_at = now()
    WHERE work_order_id = p_work_order_id;

    IF jsonb_array_length(lines) > 0 AND w.external_ref IS NOT NULL
       AND w.source = 'onkey' THEN
        IF task.task_id IS NULL THEN
            queue_state := 'blocked';
            queue_note := format(
                'no work task known for %s, so the costing has no parent to hang off; fetch tasks and release',
                w.external_ref);
        ELSIF no_van THEN
            -- A statement about the person, not a fault in the pipeline.
            queue_state := 'blocked';
            queue_note := format(
                '%s has no van, so holds no stock to issue and cannot book spares. The parts are recorded on the job card. Travel and labour also need a warehouse (E202189) and where they should book is an open question, see #131.',
                coalesce((SELECT name FROM onkey_technicians WHERE staff_code = w.staff_code),
                         w.staff_code));
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
                    'noVan', no_van,
                    'workPerformed', jc.work_performed),
                queue_state, queue_note, app_email());
    END IF;

    PERFORM app_wo_transition(p_work_order_id, 'sign_off', NULL, NULL, NULL, NULL, p_occurred_at);

    RETURN app_job_card_get(p_work_order_id);
END $function$;

/** The screen needs to know before the client is waiting, so the bundle
 * carries it. */
CREATE OR REPLACE FUNCTION app_job_card_costing_note(p_work_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN technician_has_no_van(w.staff_code)
            THEN 'You have no van on record, so parts recorded here are not booked out of stock. They still appear on the job card.'
        WHEN costing_warehouse_for(w.staff_code) IS NULL
            THEN 'Your van is not confirmed yet, so the costing will be held until the office confirms it.'
        ELSE NULL
    END
    FROM work_orders w WHERE w.id = p_work_order_id;
$function$;

GRANT EXECUTE ON FUNCTION app_job_card_sign(uuid, text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_costing_note(uuid) TO authenticated;
