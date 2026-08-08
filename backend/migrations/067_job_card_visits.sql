-- Labour and travel per visit, entered by the technician (#121).
--
-- The first real job card printed one minute of measured working time and
-- four point two hours of charged labour, four lines apart, on the page the
-- client signs. The timer measures how long the app sat in a state, not how
-- long anyone worked, so it was never a billing figure and should not have
-- been printed next to one.
--
-- Owner decision (2026-08-08): keep the manual entry, drop the timer from
-- the document, and record labour and travel FOR EACH VISIT.
--
-- The flat columns stay and are maintained as the SUM of the visits, so
-- job_card_lines and everything reading them keep working and cannot
-- disagree with the page: they are derived, not a second place to type.
--
-- Idempotent.

ALTER TABLE work_order_job_cards
    ADD COLUMN IF NOT EXISTS visits jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Existing cards become a single visit carrying what they already held, so
-- nothing saved before this change loses its numbers or stops printing.
UPDATE work_order_job_cards
   SET visits = jsonb_build_array(jsonb_build_object(
           'seq', 1,
           'date', to_char(coalesce(signed_at, updated_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
           'distanceKm', distance_km,
           'labourHours', labour_hours,
           'labourOt15Hours', labour_ot15_hours,
           'labourOt20Hours', labour_ot20_hours))
 WHERE visits = '[]'::jsonb
   AND (distance_km > 0 OR labour_hours > 0 OR labour_ot15_hours > 0 OR labour_ot20_hours > 0);

/** Totals from the visits. One definition, used by the save and by the
 * document, so "4.2 hrs charged" is always the sum of what is printed
 * above it. */
CREATE OR REPLACE FUNCTION job_card_visit_totals(p_visits jsonb)
RETURNS TABLE (distance_km numeric, labour_hours numeric,
               labour_ot15 numeric, labour_ot20 numeric)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        coalesce(sum((v ->> 'distanceKm')::numeric), 0),
        coalesce(sum((v ->> 'labourHours')::numeric), 0),
        coalesce(sum((v ->> 'labourOt15Hours')::numeric), 0),
        coalesce(sum((v ->> 'labourOt20Hours')::numeric), 0)
      FROM jsonb_array_elements(coalesce(p_visits, '[]'::jsonb)) v;
$function$;

CREATE OR REPLACE FUNCTION app_job_card_save(
    p_work_order_id uuid,
    p_distance_km numeric DEFAULT 0,
    p_labour_hours numeric DEFAULT 0,
    p_labour_ot15 numeric DEFAULT 0,
    p_labour_ot20 numeric DEFAULT 0,
    p_parts jsonb DEFAULT '[]'::jsonb,
    p_work_performed text DEFAULT NULL,
    p_visits jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    v jsonb;
    t record;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;
    IF EXISTS (SELECT 1 FROM work_order_job_cards
                WHERE work_order_id = p_work_order_id AND state = 'signed') THEN
        RAISE EXCEPTION 'This job card has been signed and cannot be changed';
    END IF;

    -- A caller that sends no visits (an older client) keeps the flat
    -- behaviour: one visit holding its totals. Nothing is lost by an app
    -- that has not been updated yet.
    v := coalesce(p_visits, jsonb_build_array(jsonb_build_object(
             'seq', 1,
             'date', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
             'distanceKm', coalesce(p_distance_km, 0),
             'labourHours', coalesce(p_labour_hours, 0),
             'labourOt15Hours', coalesce(p_labour_ot15, 0),
             'labourOt20Hours', coalesce(p_labour_ot20, 0))));

    SELECT * INTO t FROM job_card_visit_totals(v);

    INSERT INTO work_order_job_cards (
        work_order_id, distance_km, labour_hours, labour_ot15_hours,
        labour_ot20_hours, parts, work_performed, visits)
    VALUES (p_work_order_id, t.distance_km, t.labour_hours,
            t.labour_ot15, t.labour_ot20,
            coalesce(p_parts, '[]'::jsonb), p_work_performed, v)
    ON CONFLICT (work_order_id) DO UPDATE SET
        distance_km = EXCLUDED.distance_km,
        labour_hours = EXCLUDED.labour_hours,
        labour_ot15_hours = EXCLUDED.labour_ot15_hours,
        labour_ot20_hours = EXCLUDED.labour_ot20_hours,
        parts = EXCLUDED.parts,
        work_performed = EXCLUDED.work_performed,
        visits = EXCLUDED.visits,
        updated_at = now();

    RETURN app_job_card_get(p_work_order_id);
END $function$;

CREATE OR REPLACE FUNCTION app_job_card_get(p_work_order_id uuid)
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

GRANT EXECUTE ON FUNCTION app_job_card_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_save(uuid, numeric, numeric, numeric, numeric, jsonb, text, jsonb) TO authenticated;
REVOKE ALL ON FUNCTION job_card_visit_totals(jsonb) FROM anon, authenticated;

-- The 7-argument save is replaced by the 8-argument one. Dropping it stops
-- an older client silently binding to a version that ignores visits.
DROP FUNCTION IF EXISTS app_job_card_save(uuid, numeric, numeric, numeric, numeric, jsonb, text);
