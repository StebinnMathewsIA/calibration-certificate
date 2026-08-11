-- Surface the costing note on the job card bundle (#131).
--
-- Finding out that parts will not be booked at the moment the client is
-- standing there waiting for a signature is too late. Regenerated from the
-- live definition rather than retyped.
--
-- Idempotent.

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
END $function$
;
GRANT EXECUTE ON FUNCTION app_job_card_get(uuid) TO authenticated;
