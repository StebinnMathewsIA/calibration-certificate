-- Work order assignment write-back (#105). Planning owns allocation in
-- OnKey today, so this is not exposed to technicians: no grant to
-- authenticated, and no button in the app. It exists so we can move test
-- work orders onto a technician for field testing, and because taking over
-- planning is the stated direction (CLAUDE.md, on-the-way note).
--
-- The write is a Merge on the work order Code carrying StaffCode and
-- NOTHING else. An OnKey import writes every field it is given, so sending
-- a field you did not mean to change is how you overwrite somebody's data
-- with your own defaults.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION onkey_enqueue_assignment(
    p_wo_code text,
    p_staff_code text,
    p_actor text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    new_id uuid;
BEGIN
    SELECT * INTO w FROM work_orders WHERE external_ref = p_wo_code;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Work order % is not in our mirror', p_wo_code;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM onkey_technicians WHERE staff_code = p_staff_code) THEN
        RAISE EXCEPTION 'Staff code % is not in the technician register', p_staff_code;
    END IF;
    IF w.staff_code IS NOT DISTINCT FROM p_staff_code THEN
        RETURN jsonb_build_object('queued', false, 'reason', 'already assigned to this technician');
    END IF;

    INSERT INTO onkey_outbox (kind, wo_code, work_order_id, seq, payload, state, created_by)
    VALUES ('work_order_merge', p_wo_code, w.id, 1,
            jsonb_build_object('staffCode', p_staff_code),
            'pending', coalesce(p_actor, app_email()))
    RETURNING id INTO new_id;

    -- Our mirror is NOT updated here. The export is the source of truth for
    -- allocation and refreshes every minute; writing it optimistically would
    -- show the job on the wrong technician's phone if OnKey refused.
    RETURN jsonb_build_object(
        'queued', true, 'outboxId', new_id,
        'from', w.staff_code, 'to', p_staff_code);
END $function$;

REVOKE ALL ON FUNCTION onkey_enqueue_assignment(text, text, text) FROM anon, authenticated;
