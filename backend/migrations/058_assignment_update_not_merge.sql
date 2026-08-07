-- Assignment write: Update, not Merge (#105). Proven live 2026-08-07.
--
-- Merge on ImportWorkOrders is a full upsert. Sending a Merge carrying only
-- Code and StaffCode was rejected with six errors at once:
--
--   E5040: Value not specified for 'AssetId'.
--   E5040: Value not specified for 'TypeOfWorkId'.
--   E5040: Value not specified for 'SectionId'.
--   E5040: Value not specified for 'TradeId'.
--   E5040: Value not specified for 'GeneralLedgerId'.
--   E5040: Value not specified for 'CostCentreId'.
--
-- so a Merge has to restate the whole mandatory set, which means echoing
-- back six values we did not intend to touch and would silently overwrite
-- if our copy were stale. Update patches only what it is given, and the
-- same write with Action=Update was accepted and is visible in OnKey's own
-- export. Update is therefore the correct action for every partial write
-- we make, not just this one.
--
-- (The earlier rejection, "E5045: Code may not be null or empty", was ours:
-- the base-type elements are in a different XML namespace from the derived
-- type's fields, so WCF was silently discarding Code. Fixed in soap.ts.)
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
            jsonb_build_object('action', 'Update', 'staffCode', p_staff_code),
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
