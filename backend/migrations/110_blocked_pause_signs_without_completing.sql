-- 110: sealing a handed-back pause signs without completing (#166).
--
-- A pause whose reason blocks resume hands the job to the office. The
-- client still signs the incomplete card on site (owner rule), and the
-- costing still books, but the signature must NOT complete a job the
-- technician cannot even resume. The lifecycle decides, not a new
-- parameter: sealing while paused under a blocking reason fires no
-- transition; everywhere else keeps the #165 semantics (the signature
-- completes the job). Only the tail of app_job_card_sign changes.

CREATE OR REPLACE FUNCTION app_job_card_sign(
    p_work_order_id uuid,
    p_client_name text,
    p_client_signature text,
    p_tech_signature text DEFAULT NULL,
    p_occurred_at timestamptz DEFAULT NULL,
    p_client_contact text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    w work_orders%ROWTYPE;
    jc work_order_job_cards%ROWTYPE;
    lc work_order_lifecycle%ROWTYPE;
    lines jsonb;
    task onkey_work_tasks%ROWTYPE;
    warehouse text;
    no_van boolean;
    note text;
    queue_state text;
    queue_note text;
    pause_blocks boolean;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO lc FROM work_order_lifecycle WHERE work_order_id = p_work_order_id;
    IF coalesce(lc.state, 'not_started') IN ('not_started', 'on_the_way') THEN
        RAISE EXCEPTION 'Start the job before the client signs';
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
        client_contact = nullif(trim(coalesce(p_client_contact, '')), ''),
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

    -- Sign-off IS completion (#165), except for a handed-back pause
    -- (#166): a job the technician cannot resume cannot be completed by
    -- them either, so the signature there is the client's acknowledgement
    -- of the incomplete work and the job stays paused with the office.
    IF lc.state = 'paused' THEN
        SELECT coalesce(blocks_resume, false) INTO pause_blocks
          FROM work_order_pause_reasons WHERE code = lc.pause_reason;
        IF coalesce(pause_blocks, false) THEN
            RETURN app_job_card_get(p_work_order_id);
        END IF;
    END IF;

    IF lc.state = 'stopped' THEN
        PERFORM app_wo_transition(p_work_order_id, 'sign_off', NULL, NULL, NULL, NULL, p_occurred_at);
    ELSE
        PERFORM app_wo_transition(p_work_order_id, 'stop', NULL, NULL, NULL, NULL, p_occurred_at);
    END IF;

    RETURN app_job_card_get(p_work_order_id);
END $$;
