-- 108: the client signs before Complete (#162).
--
-- Field reality, from the owner after using #159 on site: the client is
-- standing there while the work is being finished, so the sign-off comes
-- BEFORE the technician taps Complete, not after. Three changes:
--
--   1. work_order_job_cards gains client_contact, captured on the
--      sign-off page next to the name.
--   2. app_job_card_sign seals from started or paused as well as
--      stopped. It only fires the lifecycle sign_off transition when the
--      job is already stopped (the old flow, which still works); when the
--      job is still running, sealing is just sealing.
--   3. app_wo_transition('stop') rolls straight on to signed_off when
--      the job card is already signed, so Complete lands the job in its
--      final state in one tap. Both events are recorded and both OnKey
--      transitions are queued, exactly as the two-tap sequence did.

ALTER TABLE work_order_job_cards ADD COLUMN IF NOT EXISTS client_contact varchar;

-- The argument list changes, so the old function must go or the two
-- overloads would be ambiguous to PostgREST.
DROP FUNCTION IF EXISTS app_job_card_sign(uuid, text, text, text, timestamptz);

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

    -- The old flow: a job stopped before signing moves to signed_off the
    -- moment it is sealed. A job still running just holds the seal; the
    -- stop that follows advances it (see app_wo_transition below).
    IF lc.state = 'stopped' THEN
        PERFORM app_wo_transition(p_work_order_id, 'sign_off', NULL, NULL, NULL, NULL, p_occurred_at);
    END IF;

    RETURN app_job_card_get(p_work_order_id);
END $$;

REVOKE ALL ON FUNCTION app_job_card_sign(uuid, text, text, text, timestamptz, text) FROM anon;
GRANT EXECUTE ON FUNCTION app_job_card_sign(uuid, text, text, text, timestamptz, text) TO authenticated;

-- Same signature as deployed, so grants survive the replace.
CREATE OR REPLACE FUNCTION app_wo_transition(
    p_work_order_id uuid, p_event text, p_reason text DEFAULT NULL,
    p_note text DEFAULT NULL, p_device_id text DEFAULT NULL,
    p_gps text DEFAULT NULL, p_occurred_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    cur work_order_lifecycle%ROWTYPE;
    w work_orders%ROWTYPE;
    blocks boolean;
    needs_note boolean;
    new_state text;
    occurred timestamptz;
    clock_note text;
    event_id uuid;
    queued int;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO cur FROM work_order_lifecycle WHERE work_order_id = p_work_order_id;
    IF NOT FOUND THEN
        INSERT INTO work_order_lifecycle (work_order_id) VALUES (p_work_order_id)
        RETURNING * INTO cur;
    END IF;

    -- Clamp the device clock. A future timestamp would make a job look
    -- finished before it started; one before the work order existed is
    -- equally impossible. Neither is silently trusted, and neither is
    -- silently discarded: the raw value and the reason are both stored.
    occurred := coalesce(p_occurred_at, now());
    IF occurred > now() THEN
        clock_note := 'device clock ahead of server, clamped to arrival';
        occurred := now();
    ELSIF occurred < coalesce(w.created_at, now() - interval '10 years') THEN
        clock_note := 'device clock before the work order existed, clamped to arrival';
        occurred := now();
    ELSIF cur.last_event_occurred_at IS NOT NULL AND occurred < cur.last_event_occurred_at THEN
        -- Replayed out of order, or the clock moved backwards. Keep the
        -- lifecycle monotonic; the raw value stays on the event row.
        clock_note := 'earlier than the previous event, clamped to keep the lifecycle in order';
        occurred := cur.last_event_occurred_at;
    END IF;

    IF p_event = 'on_the_way' THEN
        IF cur.state <> 'not_started' THEN
            RAISE EXCEPTION 'Cannot set off from state %', cur.state;
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'on_the_way', on_the_way_at = occurred,
            last_event_occurred_at = occurred,
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'on_the_way';

    ELSIF p_event = 'start' THEN
        IF cur.state NOT IN ('not_started', 'on_the_way', 'paused') THEN
            RAISE EXCEPTION 'Cannot start from state %', cur.state;
        END IF;
        IF cur.state = 'paused' THEN
            SELECT blocks_resume INTO blocks FROM work_order_pause_reasons WHERE code = cur.pause_reason;
            IF coalesce(blocks, false) THEN
                RAISE EXCEPTION 'A work order paused for % cannot be resumed by the technician', cur.pause_reason;
            END IF;
            UPDATE work_order_lifecycle SET
                state = 'started',
                -- Paused time is measured on the SAME clock as the pause,
                -- so an offline pause and an offline resume cancel out.
                paused_seconds = paused_seconds + greatest(0, extract(epoch FROM (occurred - paused_at))::int),
                paused_at = NULL, pause_reason = NULL, pause_note = NULL,
                last_event_occurred_at = occurred,
                updated_by = app_email(), updated_at = now()
            WHERE work_order_id = p_work_order_id;
        ELSE
            UPDATE work_order_lifecycle SET
                state = 'started', started_at = coalesce(started_at, occurred),
                last_event_occurred_at = occurred,
                updated_by = app_email(), updated_at = now()
            WHERE work_order_id = p_work_order_id;
        END IF;
        new_state := 'started';

    ELSIF p_event = 'pause' THEN
        IF cur.state NOT IN ('started', 'on_the_way') THEN
            RAISE EXCEPTION 'Only a started or en-route work order can be paused';
        END IF;
        IF p_reason IS NULL OR p_reason = '' THEN
            RAISE EXCEPTION 'A pause reason is required';
        END IF;
        SELECT requires_note INTO needs_note FROM work_order_pause_reasons WHERE code = p_reason;
        IF needs_note IS NULL THEN RAISE EXCEPTION 'Unknown pause reason %', p_reason; END IF;
        IF needs_note AND coalesce(trim(p_note), '') = '' THEN
            RAISE EXCEPTION 'This pause reason requires a description';
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'paused', paused_at = occurred, pause_reason = p_reason, pause_note = p_note,
            last_event_occurred_at = occurred,
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'paused';

    ELSIF p_event = 'stop' THEN
        IF cur.state NOT IN ('started', 'paused') THEN
            RAISE EXCEPTION 'Only a started or paused work order can be stopped';
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'stopped', stopped_at = occurred,
            paused_seconds = paused_seconds + CASE WHEN cur.state = 'paused'
                THEN greatest(0, extract(epoch FROM (occurred - paused_at))::int) ELSE 0 END,
            paused_at = NULL,
            last_event_occurred_at = occurred,
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'stopped';

    ELSIF p_event = 'sign_off' THEN
        IF cur.state <> 'stopped' THEN
            RAISE EXCEPTION 'Sign-off requires a stopped work order';
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'signed_off', signed_off_at = occurred,
            last_event_occurred_at = occurred,
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'signed_off';
    ELSE
        RAISE EXCEPTION 'Unknown lifecycle event %', p_event;
    END IF;

    INSERT INTO work_order_events (
        work_order_id, event, reason, note, by_email, device_id, gps,
        occurred_at, occurred_at_raw, clock_note)
    VALUES (
        p_work_order_id, p_event, p_reason, p_note, app_email(), p_device_id, p_gps,
        occurred, p_occurred_at, clock_note)
    RETURNING id INTO event_id;

    -- Same transaction as the lifecycle change above. If this fails, the
    -- state change rolls back with it, so there is never a moment where we
    -- believe we have told OnKey something we have not. on_the_way maps to
    -- an empty code array and therefore queues nothing.
    queued := app_wo_enqueue_onkey(
        p_work_order_id, event_id, p_event, p_reason, w.status_code);

    -- Complete finishes everything (#162). When the client signed before
    -- the technician tapped Complete, the stop rolls straight on to
    -- signed_off: a second event, a second OnKey transition, exactly what
    -- the old stop-then-sign sequence produced in two taps.
    IF p_event = 'stop' AND EXISTS (
        SELECT 1 FROM work_order_job_cards jc
         WHERE jc.work_order_id = p_work_order_id AND jc.state = 'signed') THEN
        RETURN app_wo_transition(p_work_order_id, 'sign_off', NULL,
            'automatic: the job card was signed before completion',
            p_device_id, p_gps, occurred);
    END IF;

    RETURN (SELECT app_wo_row(w2) FROM work_orders w2 WHERE w2.id = p_work_order_id);
END $$;

-- app_job_card_get returns the contact next to the name.
CREATE OR REPLACE FUNCTION app_job_card_get(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    w work_orders%ROWTYPE;
    l work_order_lifecycle%ROWTYPE;
    jc work_order_job_cards%ROWTYPE;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO l FROM work_order_lifecycle WHERE work_order_id = p_work_order_id;
    SELECT * INTO jc FROM work_order_job_cards WHERE work_order_id = p_work_order_id;

    RETURN jsonb_build_object(
        'workOrderId', p_work_order_id,
        'workOrderCode', w.external_ref,
        'siteName', w.site_name,
        'lifecycleState', coalesce(l.state, 'not_started'),
        -- Kept in the payload because the screen still shows the lifecycle,
        -- but NO LONGER a labour prefill and never printed. It measures how
        -- long the app was in a state.
        'workedMinutes', 0,
        'workRequired', w.work_required,
        -- Said before the client is waiting, not at the moment of refusal.
        'costingNote', app_job_card_costing_note(p_work_order_id),
        -- What the office says must be done (#152). Empty until fetched;
        -- the app asks via app_job_card_fetch_tasks when it sees none.
        'tasks', job_card_tasks_json(w.external_ref),
        'chargeItems', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                            'itemCode', c.item_code, 'description', c.description,
                            'unit', c.unit, 'kind', c.kind) ORDER BY c.sort_order), '[]'::jsonb)
                        FROM onkey_charge_items c WHERE c.is_active),
        'jobCard', CASE WHEN jc.work_order_id IS NULL THEN NULL ELSE jsonb_build_object(
            'distanceKm', jc.distance_km,
            'labourHours', jc.labour_hours,
            'labourOt15Hours', jc.labour_ot15_hours,
            'labourOt20Hours', jc.labour_ot20_hours,
            'visits', jc.visits,
            'parts', jc.parts,
            'workPerformed', jc.work_performed,
            'clientName', jc.client_name,
            'clientContact', jc.client_contact,
            'clientSignature', jc.client_signature,
            'techSignature', jc.tech_signature,
            'state', jc.state,
            'signedAt', to_char(jc.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
        END,
        'document', jsonb_build_object(
            'siteCode', w.site_id,
            'siteAddress', (SELECT s.address FROM onkey_sites s WHERE s.site_number = w.site_id),
            'sitePhone', (SELECT s.telephone FROM onkey_sites s WHERE s.site_number = w.site_id),
            'oilCompany', (SELECT s.oil_company_name FROM onkey_sites s WHERE s.site_number = w.site_id),
            'customerName', w.customer_name,
            'assetCode', w.asset_code,
            'assetDescription', w.asset_description,
            'importance', (SELECT i.description FROM onkey_importances i
                            WHERE i.code = w.importance_code),
            'technicianName', coalesce(
                (SELECT t.name FROM onkey_technicians t WHERE t.staff_code = w.staff_code),
                w.staff_code),
            -- The technician's own visits, not the lifecycle's. job_card_visits()
            -- still exists and still reads the events, because that IS the
            -- audit trail; it is simply no longer presented as a measurement
            -- of work on a document somebody signs.
            'visits', coalesce(jc.visits, '[]'::jsonb),
            'lines', job_card_lines(p_work_order_id)));
END $$;
