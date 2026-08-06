-- 055_job_card.sql
--
-- The job card: what the technician records at the end of a job and what
-- the client signs. Backed by jobCardHtml.ts, which was modelled on
-- Prowalco's real "Work completion sign off" document.
--
-- The charge codes are a REGISTER, not constants in the app. They came
-- from the OnKey stock master (FIELDOPS - INV), so if Prowalco adds a
-- Sunday rate it is a row here rather than a release. Owner confirmed the
-- 1.5 and 2.0 overtime items exist, and they do:
--
--   LAB_TECH        LABOUR - ON SITE                    hrs
--   LAB(1.5)_TECH   LABOUR - ON SITE - 1.5 OVERTIME     hrs
--   LAB(2.0)_TECH   LABOUR - ON SITE - 2.0 OVERTIME     hrs
--   TRA_TECH        Technician Travel Time              km
--   VEH_TECH        Prowalco Technician Vehicle         km
--
-- One inconsistency preserved deliberately: VEH_TECH's unit in the stock
-- master is EA, but every booked line uses km. The booked usage wins here,
-- because that is what the client is signing for and what costing reads.
--
-- Distance is ONE flat number (owner decision). It produces two OnKey
-- lines, VEH_TECH and TRA_TECH, because that is how the real data is
-- booked: 127 of the 128 work orders carrying both had identical
-- quantities. The technician should not have to type it twice to satisfy
-- somebody else's data model.

CREATE TABLE IF NOT EXISTS onkey_charge_items (
    item_code    varchar(32) PRIMARY KEY,
    description  text NOT NULL,
    unit         varchar(12) NOT NULL,
    kind         varchar(16) NOT NULL,
    sort_order   smallint NOT NULL DEFAULT 0,
    is_active    boolean NOT NULL DEFAULT true
);

COMMENT ON TABLE onkey_charge_items IS
    'Non-stock charge codes the job card books as work task spares. kind: '
    'distance (one input, two lines) or labour (one input per rate).';

INSERT INTO onkey_charge_items (item_code, description, unit, kind, sort_order) VALUES
    ('VEH_TECH',      'Prowalco Technician Vehicle',     'km',  'distance', 10),
    ('TRA_TECH',      'Technician Travel Time',          'km',  'distance', 20),
    ('LAB_TECH',      'LABOUR - ON SITE',                'hrs', 'labour',   30),
    ('LAB(1.5)_TECH', 'LABOUR - ON SITE - 1.5 OVERTIME', 'hrs', 'labour',   40),
    ('LAB(2.0)_TECH', 'LABOUR - ON SITE - 2.0 OVERTIME', 'hrs', 'labour',   50)
ON CONFLICT (item_code) DO UPDATE
    SET description = EXCLUDED.description, unit = EXCLUDED.unit,
        kind = EXCLUDED.kind, sort_order = EXCLUDED.sort_order;

ALTER TABLE onkey_charge_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON onkey_charge_items TO authenticated;

CREATE TABLE IF NOT EXISTS work_order_job_cards (
    work_order_id     uuid PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
    distance_km       numeric(10,1) NOT NULL DEFAULT 0,
    -- One column per rate rather than a jsonb blob: three fixed rates that
    -- the costing sheet reads separately, and a typo in a key would be
    -- silent where a missing column is not.
    labour_hours      numeric(6,2) NOT NULL DEFAULT 0,
    labour_ot15_hours numeric(6,2) NOT NULL DEFAULT 0,
    labour_ot20_hours numeric(6,2) NOT NULL DEFAULT 0,
    parts             jsonb NOT NULL DEFAULT '[]'::jsonb,
    work_performed    text,
    client_name       varchar(120),
    client_signature  text,
    tech_signature    text,
    state             varchar(12) NOT NULL DEFAULT 'draft'
                      CHECK (state IN ('draft', 'signed')),
    signed_at         timestamptz,
    signed_by         varchar(255),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE work_order_job_cards ENABLE ROW LEVEL SECURITY;

/** The technician's own job card, plus everything the screen needs to
 * prefill: the working time we measured, and the charge register. */
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
        END);
END $function$;

/** Autosave. Refuses to touch a signed card: the client signed THAT
 * content, and editing it afterwards would make the signature a lie. */
CREATE OR REPLACE FUNCTION app_job_card_save(
    p_work_order_id uuid,
    p_distance_km numeric DEFAULT 0,
    p_labour_hours numeric DEFAULT 0,
    p_labour_ot15 numeric DEFAULT 0,
    p_labour_ot20 numeric DEFAULT 0,
    p_parts jsonb DEFAULT '[]'::jsonb,
    p_work_performed text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
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

    INSERT INTO work_order_job_cards (
        work_order_id, distance_km, labour_hours, labour_ot15_hours,
        labour_ot20_hours, parts, work_performed)
    VALUES (p_work_order_id, coalesce(p_distance_km, 0), coalesce(p_labour_hours, 0),
            coalesce(p_labour_ot15, 0), coalesce(p_labour_ot20, 0),
            coalesce(p_parts, '[]'::jsonb), p_work_performed)
    ON CONFLICT (work_order_id) DO UPDATE SET
        distance_km = EXCLUDED.distance_km,
        labour_hours = EXCLUDED.labour_hours,
        labour_ot15_hours = EXCLUDED.labour_ot15_hours,
        labour_ot20_hours = EXCLUDED.labour_ot20_hours,
        parts = EXCLUDED.parts,
        work_performed = EXCLUDED.work_performed,
        updated_at = now();

    RETURN app_job_card_get(p_work_order_id);
END $function$;

/** Sign off: seal the job card, move the lifecycle, and queue the costing
 * lines for OnKey. All in one transaction, so a client signature never
 * exists without the work order having moved, and vice versa. */
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
    lines jsonb := '[]'::jsonb;
    part jsonb;
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

    UPDATE work_order_job_cards SET
        client_name = trim(p_client_name),
        client_signature = p_client_signature,
        tech_signature = coalesce(p_tech_signature, tech_signature),
        state = 'signed',
        signed_at = coalesce(p_occurred_at, now()),
        signed_by = app_email(),
        updated_at = now()
    WHERE work_order_id = p_work_order_id;

    -- Distance is entered once and becomes TWO lines, because that is how
    -- OnKey is booked. Zero quantities are not sent: an empty line is
    -- noise on a costing sheet somebody has to read.
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

GRANT EXECUTE ON FUNCTION app_job_card_get(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_save(uuid, numeric, numeric, numeric, numeric, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_job_card_sign(uuid, text, text, text, timestamptz) TO authenticated;
