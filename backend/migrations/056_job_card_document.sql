-- Job card document (#105): everything the PRINTED job card needs, on top
-- of what the capture screen needs. Two changes.
--
-- 1. job_card_lines() is now the ONE place the costing lines are built.
--    app_job_card_sign had them inline, so the document would have had to
--    rebuild the same rules and could drift from what is actually booked
--    to OnKey. The client must sign for exactly what is sent.
-- 2. app_job_card_get gains a 'document' block: site address and telephone,
--    oil company, asset, importance description, requester, the technician's
--    name, and the visits, each one a real start/stop pair rather than the
--    single pair OnKey's own document printed for a three-visit job.
--
-- Idempotent.

/** The costing lines a job card produces, in OnKey's own shape. Distance is
 * entered once and becomes two lines (VEH_TECH and TRA_TECH) because that
 * is how Prowalco books it: 127 of the 128 work orders carrying both had
 * identical quantities. Zero quantities are omitted; an empty line is noise
 * on a sheet somebody has to read. */
CREATE OR REPLACE FUNCTION job_card_lines(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    jc work_order_job_cards%ROWTYPE;
    lines jsonb := '[]'::jsonb;
    part jsonb;
BEGIN
    SELECT * INTO jc FROM work_order_job_cards WHERE work_order_id = p_work_order_id;
    IF NOT FOUND THEN RETURN lines; END IF;

    IF jc.distance_km > 0 THEN
        lines := lines
            || jsonb_build_array(jsonb_build_object(
                   'itemCode', 'VEH_TECH', 'quantity', jc.distance_km, 'unit', 'km'))
            || jsonb_build_array(jsonb_build_object(
                   'itemCode', 'TRA_TECH', 'quantity', jc.distance_km, 'unit', 'km'));
    END IF;
    IF jc.labour_hours > 0 THEN
        lines := lines || jsonb_build_array(jsonb_build_object(
            'itemCode', 'LAB_TECH', 'quantity', jc.labour_hours, 'unit', 'hrs'));
    END IF;
    IF jc.labour_ot15_hours > 0 THEN
        lines := lines || jsonb_build_array(jsonb_build_object(
            'itemCode', 'LAB(1.5)_TECH', 'quantity', jc.labour_ot15_hours, 'unit', 'hrs'));
    END IF;
    IF jc.labour_ot20_hours > 0 THEN
        lines := lines || jsonb_build_array(jsonb_build_object(
            'itemCode', 'LAB(2.0)_TECH', 'quantity', jc.labour_ot20_hours, 'unit', 'hrs'));
    END IF;
    FOR part IN SELECT * FROM jsonb_array_elements(jc.parts) LOOP
        lines := lines || jsonb_build_array(jsonb_build_object(
            'itemCode', part ->> 'itemCode',
            'quantity', (part ->> 'quantity')::numeric,
            'unit', coalesce(part ->> 'unit', 'EA')));
    END LOOP;

    -- Descriptions come from the register, so a code Prowalco renames is
    -- renamed on the document too, without a release.
    -- WITH ORDINALITY and an explicit ORDER BY: without them the aggregate
    -- may reorder the lines, and a costing sheet that shuffles between the
    -- screen and the printed page is one nobody can check.
    RETURN (
        SELECT coalesce(jsonb_agg(
            l.value || jsonb_build_object(
                'description',
                coalesce(c.description, l.value ->> 'itemCode'))
            ORDER BY l.ord), '[]'::jsonb)
        FROM jsonb_array_elements(lines) WITH ORDINALITY AS l(value, ord)
        LEFT JOIN onkey_charge_items c ON c.item_code = l.value ->> 'itemCode');
END $function$;

/** Each attendance on site as its own start/stop pair. A job worked over
 * three visits printed one pair of times on OnKey's document, so it claimed
 * 06:56 to 10:15 for work spread over months. */
CREATE OR REPLACE FUNCTION job_card_visits(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH ev AS (
        SELECT event,
               coalesce(occurred_at, at) AS at,
               row_number() OVER (ORDER BY coalesce(occurred_at, at), id) AS rn
          FROM work_order_events
         WHERE work_order_id = p_work_order_id
           AND event IN ('start', 'pause', 'stop')
    ),
    -- A visit runs from a start to the next pause or stop. Resuming after
    -- a pause opens a new visit, which is what actually happened on site.
    paired AS (
        SELECT s.at AS started_at,
               (SELECT e.at FROM ev e
                 WHERE e.rn > s.rn AND e.event IN ('pause', 'stop')
                 ORDER BY e.rn LIMIT 1) AS completed_at
          FROM ev s WHERE s.event = 'start'
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'startedAt', to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
               'completedAt', CASE WHEN completed_at IS NULL THEN NULL ELSE
                   to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"') END,
               'workingMinutes', CASE WHEN completed_at IS NULL THEN NULL ELSE
                   greatest(0, (extract(epoch FROM (completed_at - started_at)) / 60)::int) END)
           ORDER BY started_at), '[]'::jsonb)
      FROM paired;
$function$;

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
    worked_minutes int := 0;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO l FROM work_order_lifecycle WHERE work_order_id = p_work_order_id;
    SELECT * INTO jc FROM work_order_job_cards WHERE work_order_id = p_work_order_id;

    -- Net working time, pauses removed, measured on the technician's own
    -- clock (migration 045) so an offline job reports what it really took.
    IF l.started_at IS NOT NULL THEN
        worked_minutes := greatest(0, (
            extract(epoch FROM (coalesce(l.stopped_at, now()) - l.started_at))::int
            - coalesce(l.paused_seconds, 0)) / 60);
    END IF;

    RETURN jsonb_build_object(
        'workOrderId', p_work_order_id,
        'workOrderCode', w.external_ref,
        'siteName', w.site_name,
        'lifecycleState', coalesce(l.state, 'not_started'),
        'workedMinutes', worked_minutes,
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
            'parts', jc.parts,
            'workPerformed', jc.work_performed,
            'clientName', jc.client_name,
            'clientSignature', jc.client_signature,
            'techSignature', jc.tech_signature,
            'state', jc.state,
            'signedAt', to_char(jc.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
        END,
        -- Everything the printed document needs and the capture screen does
        -- not. Kept in one block so the PDF builder reads one object.
        'document', jsonb_build_object(
            'siteCode', w.site_id,
            'siteAddress', (SELECT s.address FROM onkey_sites s WHERE s.site_number = w.site_id),
            'sitePhone', (SELECT s.telephone FROM onkey_sites s WHERE s.site_number = w.site_id),
            'oilCompany', (SELECT s.oil_company_name FROM onkey_sites s WHERE s.site_number = w.site_id),
            'customerName', w.customer_name,
            'assetCode', w.asset_code,
            'assetDescription', w.asset_description,
            -- Printed once, and only when we actually know it. The original
            -- printed "UNKNOWN" twice, for the code and the description.
            'importance', (SELECT i.description FROM onkey_importances i
                            WHERE i.code = w.importance_code),
            'technicianName', coalesce(
                (SELECT t.name FROM onkey_technicians t WHERE t.staff_code = w.staff_code),
                w.staff_code),
            'visits', job_card_visits(p_work_order_id),
            'lines', job_card_lines(p_work_order_id)));
END $function$;

/** Sign off: seal the job card, move the lifecycle, and queue the costing
 * lines for OnKey. All in one transaction, so a client signature never
 * exists without the costing it was given for. */
CREATE OR REPLACE FUNCTION app_job_card_sign(
    p_work_order_id uuid,
    p_client_name text,
    p_client_signature text,
    p_tech_signature text DEFAULT NULL,
    p_occurred_at timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    jc work_order_job_cards%ROWTYPE;
    lines jsonb;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;

    SELECT * INTO jc FROM work_order_job_cards WHERE work_order_id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Complete the job card before signing'; END IF;
    IF jc.state = 'signed' THEN RAISE EXCEPTION 'This job card is already signed'; END IF;
    IF coalesce(trim(p_client_name), '') = '' THEN
        RAISE EXCEPTION 'The name of the person accepting the work is required';
    END IF;
    IF coalesce(trim(p_client_signature), '') = '' THEN
        RAISE EXCEPTION 'The client signature is required';
    END IF;
    IF coalesce(trim(jc.work_performed), '') = '' THEN
        RAISE EXCEPTION 'Describe the work performed before signing';
    END IF;

    -- Read BEFORE the update, so the lines are the ones the client was
    -- shown, built by the same function the document prints from.
    lines := job_card_lines(p_work_order_id);

    UPDATE work_order_job_cards SET
        client_name = trim(p_client_name),
        client_signature = p_client_signature,
        tech_signature = coalesce(p_tech_signature, tech_signature),
        state = 'signed',
        signed_at = coalesce(p_occurred_at, now()),
        signed_by = app_email(),
        updated_at = now()
    WHERE work_order_id = p_work_order_id;

    -- Queued BLOCKED on purpose. ImportWorkTaskSpares has no SOAP builder
    -- yet, and a pending row would be picked up by the drain, fail five
    -- times and dead-letter, destroying the costing. Blocked means we
    -- declined to send: the data is safe and one flip releases it once the
    -- builder lands.
    IF jsonb_array_length(lines) > 0 AND w.external_ref IS NOT NULL
       AND w.source = 'onkey' THEN
        INSERT INTO onkey_outbox (
            kind, wo_code, work_order_id, seq, payload, state, last_error, created_by)
        VALUES ('work_task_spares', w.external_ref, p_work_order_id, 1,
                jsonb_build_object('lines', lines, 'workPerformed', jc.work_performed),
                'blocked',
                'ImportWorkTaskSpares builder not implemented yet; held, not dropped',
                app_email());
    END IF;

    -- Moves the lifecycle to signed_off and queues WOS for OnKey.
    PERFORM app_wo_transition(p_work_order_id, 'sign_off', NULL, NULL, NULL, NULL, p_occurred_at);

    RETURN app_job_card_get(p_work_order_id);
END $function$;

REVOKE ALL ON FUNCTION job_card_lines(uuid) FROM anon, authenticated;
REVOKE ALL ON FUNCTION job_card_visits(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_sign(uuid, text, text, text, timestamptz) TO authenticated;
