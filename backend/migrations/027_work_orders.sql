-- Our own work-order entity and lifecycle (#95), per the system-of-record
-- rules: OUR uuid is the key, OnKey's code is an external reference, and
-- the lifecycle states are canonical (OnKey status codes are an adapter
-- mapping, added later). Includes clearly-marked DEMO rows so the UI can
-- be built before the FIELDOPS report lands: delete with
--     DELETE FROM work_orders WHERE is_demo;
-- Idempotent.

CREATE TABLE IF NOT EXISTS work_orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 'onkey' seeded from the export, 'native' ours, 'demo' throwaway.
    source varchar(16) NOT NULL DEFAULT 'onkey',
    external_ref varchar(64),          -- OnKey work order Code
    onkey_id bigint,
    staff_code varchar(64),
    site_id varchar(64),
    site_name text,
    customer_name text,
    asset_code varchar(64),
    asset_description text,
    work_required text,
    status_code varchar(64),
    status_description varchar(120),
    importance_code varchar(32),
    estimated_duration_minutes int,
    received_on timestamptz,
    required_by timestamptz,
    complete_by timestamptz,
    gps_location text,                 -- WKT "POINT (lon lat)"
    is_demo boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS work_orders_external_ref_idx
    ON work_orders (external_ref) WHERE external_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_orders_staff_idx ON work_orders (staff_code);
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_orders FROM anon, authenticated;

-- Current lifecycle state. One row per work order.
CREATE TABLE IF NOT EXISTS work_order_lifecycle (
    work_order_id uuid PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
    state varchar(24) NOT NULL DEFAULT 'not_started'
        CHECK (state IN ('not_started', 'started', 'paused', 'stopped', 'signed_off')),
    pause_reason varchar(64),
    pause_note text,
    started_at timestamptz,
    paused_at timestamptz,
    stopped_at timestamptz,
    signed_off_at timestamptz,
    -- Sum of completed pauses; the SLA clock is (stopped-started) minus this.
    paused_seconds int NOT NULL DEFAULT 0,
    updated_by varchar(200),
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE work_order_lifecycle ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_order_lifecycle FROM anon, authenticated;

-- Append-only transition log: the audit trail and the source of the
-- domain events the OnKey adapter drains.
CREATE TABLE IF NOT EXISTS work_order_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_order_id uuid NOT NULL REFERENCES work_orders(id) ON DELETE CASCADE,
    event varchar(32) NOT NULL,
    reason varchar(64),
    note text,
    at timestamptz NOT NULL DEFAULT now(),
    by_email varchar(200),
    device_id varchar(128),
    gps text
);
CREATE INDEX IF NOT EXISTS work_order_events_wo_idx ON work_order_events (work_order_id, at);
ALTER TABLE work_order_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_order_events FROM anon, authenticated;

-- Pause reasons: the two that block technician resume are flagged
-- (SANS training slides 21-26 / FR-WO-08).
CREATE TABLE IF NOT EXISTS work_order_pause_reasons (
    code varchar(64) PRIMARY KEY,
    label varchar(120) NOT NULL,
    blocks_resume boolean NOT NULL DEFAULT false,
    requires_note boolean NOT NULL DEFAULT false,
    sort_order int NOT NULL DEFAULT 0
);
ALTER TABLE work_order_pause_reasons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON work_order_pause_reasons FROM anon, authenticated;
INSERT INTO work_order_pause_reasons (code, label, blocks_resume, requires_note, sort_order) VALUES
    ('incomplete_spares', 'Incomplete for spares', true, false, 1),
    ('referral', 'Referral to someone else', true, false, 2),
    ('awaiting_client', 'Waiting for the client or site', false, false, 3),
    ('site_unsafe', 'Site conditions or safety', false, false, 4),
    ('break', 'Break or end of shift', false, false, 5),
    ('other', 'Other', false, true, 6)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------
-- App-facing RPCs
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_wo_row(w work_orders) RETURNS jsonb
LANGUAGE sql STABLE AS $$
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
        'importanceCode', w.importance_code,
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
$$;

/* My work orders: mine by staff code, plus every DEMO row (so the UI is
   testable before the real report lands; demo rows disappear with one
   DELETE). */
CREATE OR REPLACE FUNCTION app_wo_list() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_wo_row(w) ORDER BY w.complete_by NULLS LAST), '[]'::jsonb)
    FROM work_orders w
    WHERE w.is_demo
       OR (app_staff_code() IS NOT NULL AND w.staff_code = app_staff_code())
$$;

CREATE OR REPLACE FUNCTION app_wo_pause_reasons() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
        'code', code, 'label', label,
        'blocksResume', blocks_resume, 'requiresNote', requires_note)
        ORDER BY sort_order), '[]'::jsonb)
    FROM work_order_pause_reasons
$$;

/* Apply a lifecycle transition. The state machine is enforced HERE so
   the rules hold no matter which client calls: start -> pause (reason
   mandatory) -> resume (blocked for incomplete-spares / referral) ->
   stop -> sign off. Every transition appends an event. */
CREATE OR REPLACE FUNCTION app_wo_transition(
    p_work_order_id uuid,
    p_event text,
    p_reason text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_device_id text DEFAULT NULL,
    p_gps text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    cur work_order_lifecycle%ROWTYPE;
    w work_orders%ROWTYPE;
    blocks boolean;
    needs_note boolean;
    new_state text;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    -- Demo rows are open to any signed-in user; real ones are the
    -- technician's own (view-as included via app_staff_code()).
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO cur FROM work_order_lifecycle WHERE work_order_id = p_work_order_id;
    IF NOT FOUND THEN
        INSERT INTO work_order_lifecycle (work_order_id) VALUES (p_work_order_id)
        RETURNING * INTO cur;
    END IF;

    IF p_event = 'start' THEN
        IF cur.state NOT IN ('not_started', 'paused') THEN
            RAISE EXCEPTION 'Cannot start from state %', cur.state;
        END IF;
        IF cur.state = 'paused' THEN
            SELECT blocks_resume INTO blocks FROM work_order_pause_reasons WHERE code = cur.pause_reason;
            IF coalesce(blocks, false) THEN
                RAISE EXCEPTION 'A work order paused for % cannot be resumed by the technician', cur.pause_reason;
            END IF;
            UPDATE work_order_lifecycle SET
                state = 'started',
                paused_seconds = paused_seconds + greatest(0, extract(epoch FROM (now() - paused_at))::int),
                paused_at = NULL, pause_reason = NULL, pause_note = NULL,
                updated_by = app_email(), updated_at = now()
            WHERE work_order_id = p_work_order_id;
        ELSE
            UPDATE work_order_lifecycle SET
                state = 'started', started_at = coalesce(started_at, now()),
                updated_by = app_email(), updated_at = now()
            WHERE work_order_id = p_work_order_id;
        END IF;
        new_state := 'started';

    ELSIF p_event = 'pause' THEN
        IF cur.state <> 'started' THEN
            RAISE EXCEPTION 'Only a started work order can be paused';
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
            state = 'paused', paused_at = now(), pause_reason = p_reason, pause_note = p_note,
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'paused';

    ELSIF p_event = 'stop' THEN
        IF cur.state NOT IN ('started', 'paused') THEN
            RAISE EXCEPTION 'Only a started or paused work order can be stopped';
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'stopped', stopped_at = now(),
            paused_seconds = paused_seconds + CASE WHEN cur.state = 'paused'
                THEN greatest(0, extract(epoch FROM (now() - paused_at))::int) ELSE 0 END,
            paused_at = NULL,
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'stopped';

    ELSIF p_event = 'sign_off' THEN
        IF cur.state <> 'stopped' THEN
            RAISE EXCEPTION 'Sign-off requires a stopped work order';
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'signed_off', signed_off_at = now(),
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'signed_off';
    ELSE
        RAISE EXCEPTION 'Unknown lifecycle event %', p_event;
    END IF;

    INSERT INTO work_order_events (work_order_id, event, reason, note, by_email, device_id, gps)
    VALUES (p_work_order_id, p_event, p_reason, p_note, app_email(), p_device_id, p_gps);

    RETURN (SELECT app_wo_row(w2) FROM work_orders w2 WHERE w2.id = p_work_order_id);
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_wo_list()', 'app_wo_pause_reasons()',
        'app_wo_transition(uuid, text, text, text, text, text)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
