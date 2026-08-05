-- 046_outbox_enqueue.sql
--
-- Connect the lifecycle to the OnKey outbox. The pipe was built and
-- disconnected at the tap: onkey_outbox, the drain, the allowlist and the
-- SOAP builder all existed, and nothing ever enqueued.
--
-- Two things this migration deliberately does NOT do, both corrections to
-- the first draft of the plan:
--
--  1. It does not veto on our transition register. Migration 036 recorded
--     that only 15 of 25 observed transitions appear in the target
--     register (DOCARC to CLC has fired 647 times and is absent). Gating
--     writes on data we have already proven incomplete would refuse
--     transitions OnKey would accept. The register's verdict is RECORDED
--     on the row as a warning; OnKey is the thing that refuses, and its
--     rejection is what we store.
--  2. It does not write anything for on_the_way. wo_status_map carries
--     that event with an empty code array, so the loop below produces no
--     rows without needing a special case.
--
-- The enqueue happens inside app_wo_transition, so the lifecycle change
-- and the queued write are ONE transaction. If the outbox insert fails the
-- lifecycle change rolls back with it, and there is no window in which we
-- believe we have told OnKey something we have not.

-- 'blocked' means WE declined to send. 'dead_letter' means it was sent and
-- refused, or gave up. Collapsing them loses the distinction exactly when
-- somebody is triaging at six in the morning.
ALTER TABLE onkey_outbox DROP CONSTRAINT IF EXISTS onkey_outbox_state_check;
ALTER TABLE onkey_outbox ADD CONSTRAINT onkey_outbox_state_check
    CHECK (state IN ('pending', 'blocked', 'sent', 'failed', 'dead_letter'));

-- Hop order within one lifecycle event: pause for spares is WPA then LSI,
-- two OnKey status changes for one of our events, and they must land in
-- that order.
ALTER TABLE onkey_outbox ADD COLUMN IF NOT EXISTS seq smallint NOT NULL DEFAULT 0;
-- Which of our lifecycle events produced this row, so a replayed RPC
-- cannot enqueue the same hops twice and so an operator can trace a row
-- back to the tap that caused it.
ALTER TABLE onkey_outbox ADD COLUMN IF NOT EXISTS source_event_id uuid;
ALTER TABLE onkey_outbox ADD COLUMN IF NOT EXISTS work_order_id uuid;
ALTER TABLE onkey_outbox ADD COLUMN IF NOT EXISTS not_before timestamptz;
ALTER TABLE onkey_outbox ADD COLUMN IF NOT EXISTS register_warning text;

COMMENT ON COLUMN onkey_outbox.not_before IS
    'Retry backoff: the drain skips rows until this time. Null means send now.';
COMMENT ON COLUMN onkey_outbox.register_warning IS
    'Set when our transition register does not know this hop. A warning '
    'only: the register is known incomplete, so OnKey decides.';

CREATE UNIQUE INDEX IF NOT EXISTS onkey_outbox_source_event_seq
    ON onkey_outbox (source_event_id, seq) WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS onkey_outbox_wo_pending
    ON onkey_outbox (wo_code, seq, created_at) WHERE state IN ('pending', 'failed', 'blocked');

/** Queue the OnKey status changes for one lifecycle event. Returns how
 * many hops were queued. Called inside app_wo_transition's transaction. */
CREATE OR REPLACE FUNCTION app_wo_enqueue_onkey(
    p_work_order_id uuid,
    p_event_id uuid,
    p_event text,
    p_reason text,
    p_current_status text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    plan jsonb;
    hop jsonb;
    i smallint := 0;
    queued int := 0;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND OR w.external_ref IS NULL THEN RETURN 0; END IF;
    -- Only OnKey-sourced work orders have anything to write back to.
    IF w.source IS DISTINCT FROM 'onkey' THEN RETURN 0; END IF;

    plan := onkey_transition_plan(p_current_status, p_event, coalesce(p_reason, ''));

    FOR hop IN SELECT * FROM jsonb_array_elements(plan -> 'hops') LOOP
        i := i + 1;
        INSERT INTO onkey_outbox (
            kind, wo_code, work_order_id, source_event_id, seq, payload,
            state, register_warning, created_by)
        VALUES (
            'status_change',
            w.external_ref,
            p_work_order_id,
            p_event_id,
            i,
            jsonb_build_object(
                'stateCode', hop ->> 'to',
                'fromStatus', hop ->> 'from',
                'ourEvent', p_event,
                'ourReason', coalesce(p_reason, ''),
                -- ImportWorkOrderChangeStatusAndQueue has no
                -- ExternalReference field, only Remark, so the remark is
                -- where our event id has to live for traceability.
                'remark', 'PWC ' || p_event || ' ' || p_event_id::text),
            'pending',
            CASE WHEN (hop ->> 'allowed')::boolean THEN NULL
                 ELSE format('our register does not list %s to %s; sending anyway, OnKey decides',
                             hop ->> 'from', hop ->> 'to') END,
            app_email())
        -- The predicate is repeated because the index is PARTIAL: index
        -- inference needs an exact match, and without it Postgres cannot
        -- find the constraint at all.
        ON CONFLICT (source_event_id, seq) WHERE source_event_id IS NOT NULL DO NOTHING;
        queued := queued + 1;
    END LOOP;

    RETURN queued;
END $function$;

REVOKE ALL ON FUNCTION app_wo_enqueue_onkey(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_wo_enqueue_onkey(uuid, uuid, text, text, text) FROM anon, authenticated;

-- app_wo_transition, unchanged from migration 045 except that it now
-- captures the event id and queues the OnKey hops in the same transaction.
CREATE OR REPLACE FUNCTION app_wo_transition(
    p_work_order_id uuid,
    p_event text,
    p_reason text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_device_id text DEFAULT NULL,
    p_gps text DEFAULT NULL,
    p_occurred_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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

    RETURN (SELECT app_wo_row(w2) FROM work_orders w2 WHERE w2.id = p_work_order_id);
END $function$;

