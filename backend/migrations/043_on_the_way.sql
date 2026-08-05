-- 043_on_the_way.sql
--
-- Owner decision, 2026-08-05: the technician accepts a job and is
-- travelling to it. This state lives in OUR database only. Nothing is
-- written to OnKey for it, deliberately, and not because we cannot:
-- OnKey has no status for travelling, Allocated permits only one forward
-- move (to Work Order Received), and inventing a meaning for an existing
-- status would put a wrong statement into somebody else's system of
-- record. When we take over planning, this is surfaced to the planning
-- team directly.
--
-- So the lifecycle gains a state before started:
--
--   not_started -> on_the_way -> started -> paused/resumed -> stopped -> signed_off
--                       \______________________/
--                        (start direct: already on site)
--
-- Accepting is one-way. A technician who taps On the way and then finds
-- the site closed pauses or stops the job with a reason, which IS
-- recorded, rather than silently un-accepting it.

ALTER TABLE work_order_lifecycle DROP CONSTRAINT IF EXISTS work_order_lifecycle_state_check;
ALTER TABLE work_order_lifecycle ADD CONSTRAINT work_order_lifecycle_state_check
    CHECK (state IN ('not_started', 'on_the_way', 'started', 'paused', 'stopped', 'signed_off'));

ALTER TABLE work_order_lifecycle ADD COLUMN IF NOT EXISTS on_the_way_at timestamptz;

COMMENT ON COLUMN work_order_lifecycle.on_the_way_at IS
    'When the technician accepted the job and set off. Ours alone: OnKey '
    'has no travelling status and we do not write one.';

-- Recorded so the omission is visible next to the events that DO write.
-- An empty onkey_codes array means "ours only, write nothing".
INSERT INTO wo_status_map (event, reason, onkey_codes, note, onkey_event_type)
VALUES ('on_the_way', '', ARRAY[]::text[],
        'Accepted and travelling. OURS ONLY: OnKey has no travelling '
        'status, so nothing is written. Surface to planning when we own '
        'planning.', NULL)
ON CONFLICT (event, reason) DO UPDATE
   SET onkey_codes = EXCLUDED.onkey_codes,
       note = EXCLUDED.note,
       onkey_event_type = EXCLUDED.onkey_event_type;

CREATE OR REPLACE FUNCTION app_wo_transition(
    p_work_order_id uuid,
    p_event text,
    p_reason text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_device_id text DEFAULT NULL,
    p_gps text DEFAULT NULL)
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

    IF p_event = 'on_the_way' THEN
        IF cur.state <> 'not_started' THEN
            RAISE EXCEPTION 'Cannot set off from state %', cur.state;
        END IF;
        UPDATE work_order_lifecycle SET
            state = 'on_the_way', on_the_way_at = now(),
            updated_by = app_email(), updated_at = now()
        WHERE work_order_id = p_work_order_id;
        new_state := 'on_the_way';

    ELSIF p_event = 'start' THEN
        -- 'not_started' stays valid: a technician already at the site
        -- should not have to claim a journey they did not make.
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
        -- Travelling counts: a technician who sets off and is turned away
        -- at the gate pauses with a reason rather than silently reverting.
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
END $function$;

-- The row the app reads has to carry the new state and its timestamp.
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

-- Travelling is live work: it must keep the job on the list whatever the
-- office does to the status, exactly like started and paused.
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
            OR l.state IN ('on_the_way', 'started', 'paused')
          )
      AND (
            coalesce(s.technician_stage, 0) < app_wo_finished_stage()
            OR coalesce(l.signed_off_at, l.stopped_at, l.updated_at, w.updated_at)
               >= app_day_start()
          )
$function$;
