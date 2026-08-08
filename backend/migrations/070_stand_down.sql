-- Standing down from a journey (#127).
--
-- "Cannot get there" was wired to the pause flow, because pause was the
-- only transition that could move a job off on_the_way. So a technician who
-- could not reach a site was asked "Why are you pausing?" and offered six
-- reasons about work in progress, two of which permanently block them from
-- resuming. None of them describes a journey that did not happen, and
-- whichever they picked left the job PAUSED, which reads everywhere
-- downstream as "started and interrupted". They never arrived.
--
-- stand_down is valid only from on_the_way and returns the work order to
-- not_started. Nothing is written to OnKey: on_the_way is ours alone
-- (migration 043), OnKey has no travelling status, so there is nothing
-- there to undo either.
--
-- The journey and the stand-down are both events, so a job repeatedly
-- claimed and abandoned is visible rather than invisible.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION app_wo_stand_down(
    p_work_order_id uuid,
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
    w work_orders%ROWTYPE;
    cur work_order_lifecycle%ROWTYPE;
    occurred timestamptz;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO cur FROM work_order_lifecycle WHERE work_order_id = p_work_order_id;
    IF cur.state IS DISTINCT FROM 'on_the_way' THEN
        RAISE EXCEPTION 'You can only stand down from a journey you are on, not from %',
            coalesce(cur.state, 'not started');
    END IF;

    occurred := least(coalesce(p_occurred_at, now()), now());

    UPDATE work_order_lifecycle SET
        state = 'not_started',
        on_the_way_at = NULL,
        last_event_occurred_at = occurred,
        updated_by = app_email(),
        updated_at = now()
    WHERE work_order_id = p_work_order_id;

    INSERT INTO work_order_events (
        work_order_id, event, reason, note, by_email, device_id, gps, at, occurred_at)
    VALUES (p_work_order_id, 'stand_down', NULL, p_note, app_email(),
            p_device_id, p_gps, now(), occurred);

    RETURN app_wo_row(w);
END $function$;

GRANT EXECUTE ON FUNCTION app_wo_stand_down(uuid, text, text, text, timestamptz) TO authenticated;
