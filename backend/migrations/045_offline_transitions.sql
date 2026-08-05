-- 045_offline_transitions.sql
--
-- Lifecycle transitions become offline-capable, which they were not: the
-- app called app_wo_transition directly with no outbox, so a technician at
-- a zero-signal forecourt could not start, pause or stop a job at all.
-- That is the exact place this app is meant to work.
--
-- The correctness problem is TIME, not transport. A job started at 08:42
-- offline and replayed at 11:05 would have recorded 11:05, quietly
-- destroying the working-time figure and the audit trail. So the RPC takes
-- the moment the technician acted (p_occurred_at, the device clock) and
-- records BOTH: occurred_at is when it happened, `at` stays when the server
-- learned of it. This is the same distinction CLAUDE.md already draws for
-- signing, between intent-to-sign on the device clock and the TSA time.
--
-- Device clocks lie, so occurred_at is clamped: never in the future, never
-- before the work order existed. Both raw and clamped values are kept, and
-- a clamp is recorded rather than silently applied.

ALTER TABLE work_order_events ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE work_order_events ADD COLUMN IF NOT EXISTS occurred_at_raw timestamptz;
ALTER TABLE work_order_events ADD COLUMN IF NOT EXISTS clock_note text;

COMMENT ON COLUMN work_order_events.occurred_at IS
    'When the technician acted, by the device clock, clamped to a sane '
    'range. Equals `at` for online actions.';
COMMENT ON COLUMN work_order_events.occurred_at_raw IS
    'The device clock value as supplied, before clamping. Kept so a wrong '
    'device clock is evidence rather than a mystery.';
COMMENT ON COLUMN work_order_events.clock_note IS
    'Set when occurred_at had to be clamped, saying why.';

-- Existing rows happened online, so they occurred when they landed.
UPDATE work_order_events SET occurred_at = "at" WHERE occurred_at IS NULL;

ALTER TABLE work_order_lifecycle ADD COLUMN IF NOT EXISTS last_event_occurred_at timestamptz;

-- Adding a parameter creates a NEW overload; it does not replace the old
-- function. Postgres identifies a function by name AND argument types, so
-- the six-argument version from migration 043 would survive and a call
-- that omits p_occurred_at would bind to IT, silently ignoring the device
-- clock. Drop it first, then every caller lands on the version below and
-- picks up the default.
DROP FUNCTION IF EXISTS app_wo_transition(uuid, text, text, text, text, text);

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
        occurred, p_occurred_at, clock_note);

    RETURN (SELECT app_wo_row(w2) FROM work_orders w2 WHERE w2.id = p_work_order_id);
END $function$;

-- The app needs the occurred-at times to show working time honestly when
-- the run happened offline.
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
                'onTheWayAt', to_char(l.on_the_way_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'startedAt', to_char(l.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedAt', to_char(l.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'stoppedAt', to_char(l.stopped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedSeconds', coalesce(l.paused_seconds, 0))
            FROM work_order_lifecycle l
            LEFT JOIN work_order_pause_reasons r ON r.code = l.pause_reason
            WHERE l.work_order_id = w.id))
$function$;
