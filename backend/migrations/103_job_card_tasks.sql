-- Tasks on the job card (#152).
--
-- The work tasks are mirrored (onkey_work_tasks, #110) and the printed
-- template has carried a tasks page since #108, but the bundle never
-- carried any rows, so the technician and the client sign a card missing
-- the work specification the original prints. Two additions:
--
--   1. app_job_card_get returns the mirror's tasks for the work order.
--   2. app_job_card_fetch_tasks lets the app ask OnKey for one work
--      order's tasks when the mirror has none, riding onkey_fetch_tasks
--      (the per-work-order export with the [-escaped LIKE filter). The
--      mirror covers 24 of 951 open work orders today, because nothing
--      fetched tasks in the normal flow; fetching per opened job card
--      covers the jobs anyone actually works.
--
-- app_job_card_get is regenerated from the live definition (081), not
-- retyped.
--
-- Idempotent.

/** The mirror's tasks for one OnKey work order code, shaped exactly as
 * the mobile document template (JobCardTask) expects them. */
CREATE OR REPLACE FUNCTION job_card_tasks_json(p_wo_code text)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'description', t.task_description,
               'done', coalesce(t.is_complete, false),
               'passed', t.inspection_passed,
               'completedOn', to_char(t.completed_on AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
               ORDER BY coalesce(t.sequence_number, 0), t.task_id), '[]'::jsonb)
      FROM onkey_work_tasks t
     WHERE t.work_order_code = p_wo_code;
$function$;

CREATE OR REPLACE FUNCTION public.app_job_card_get(p_work_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$;

/** Fetch one work order's tasks from OnKey into the mirror, then return
 * them. Allocation-checked like the bundle itself. When the mirror
 * already has rows it returns them WITHOUT calling OnKey: the app only
 * asks when it sees none, and this keeps a retry loop from hammering the
 * export service. The Edge Function call can take tens of seconds on a
 * slow link, so the app calls this in the background, never on the
 * render path. */
CREATE OR REPLACE FUNCTION app_job_card_fetch_tasks(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    existing jsonb;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;
    IF coalesce(w.external_ref, '') = '' THEN
        RETURN jsonb_build_object('fetched', false,
            'reason', 'no OnKey code on this work order', 'tasks', '[]'::jsonb);
    END IF;

    existing := job_card_tasks_json(w.external_ref);
    IF jsonb_array_length(existing) > 0 THEN
        RETURN jsonb_build_object('fetched', false,
            'reason', 'already mirrored', 'tasks', existing);
    END IF;

    PERFORM onkey_fetch_tasks(w.external_ref);
    RETURN jsonb_build_object('fetched', true,
        'tasks', job_card_tasks_json(w.external_ref));
END $function$;

GRANT EXECUTE ON FUNCTION app_job_card_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_fetch_tasks(uuid) TO authenticated;
REVOKE ALL ON FUNCTION job_card_tasks_json(text) FROM anon, authenticated;
