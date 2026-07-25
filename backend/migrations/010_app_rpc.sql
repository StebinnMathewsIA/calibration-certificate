-- Architecture v2 phase 1 (#64, #65): the app reads Supabase DIRECTLY.
-- SECURITY DEFINER functions replicate the exact response shapes the v1
-- Render read endpoints produced (camelCase keys, store-wins-over-seed
-- resolution), so the mobile client only swaps transport. All app tables
-- are already RLS-locked with no anon/authenticated grants (005/007) —
-- these functions are the ONLY thing the public API key can reach.
-- Idempotent; applied by apply_migrations.py.

-- Demo alias sign-ins (#57). Mirrors ONKEY_DEMO_ALIAS_EMAILS on Render —
-- keep the two in sync until Render's copy is retired in phase 3.
CREATE TABLE IF NOT EXISTS app_demo_aliases (
    email varchar(320) PRIMARY KEY
);
INSERT INTO app_demo_aliases (email) VALUES
    ('stebinn@gmail.com'), ('sashern@prowalco.co.za')
ON CONFLICT DO NOTHING;
ALTER TABLE app_demo_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_demo_aliases FROM anon, authenticated;

-- Open-status taxonomy. MUST match OPEN_STATUSES in
-- backend/app/workorders/onkey_directory.py.
CREATE OR REPLACE FUNCTION app_open_statuses() RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$
    SELECT ARRAY['To be Planned','Allocated','Incomplete for Spares',
                 'Work Order Received','Referral','Work Resumed']
$$;

-- Signed-in email from the Supabase JWT.
CREATE OR REPLACE FUNCTION app_email() RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- Email -> staff code (demo aliases ride the busiest open technician).
CREATE OR REPLACE FUNCTION app_staff_code() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    em text := app_email();
    sc text;
BEGIN
    IF em = '' THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM app_demo_aliases WHERE email = em) THEN
        SELECT w.staff_code INTO sc
        FROM onkey_workorders w
        WHERE w.status_description = ANY (app_open_statuses())
          AND w.staff_code IS NOT NULL
        GROUP BY w.staff_code
        ORDER BY count(*) DESC, w.staff_code
        LIMIT 1;
        RETURN sc;
    END IF;
    SELECT t.staff_code INTO sc
    FROM onkey_technicians t WHERE lower(t.email) = em LIMIT 1;
    RETURN sc;
END $$;

-- ---------------------------------------------------------------------------
-- Record builders (private helpers; shapes match backend/app/routers/*.py)
-- ---------------------------------------------------------------------------

-- Work-order seed shape (onkey.py _wo_seed).
CREATE OR REPLACE FUNCTION app_wo_seed(w onkey_workorders, tech_email text) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', w.code,
        'reference', w.code,
        'assignedTechnicianEmail', lower(coalesce(tech_email, 'unassigned@prowalco.invalid')),
        'siteId', coalesce(w.site_number, ''),
        'dispenserIds', CASE WHEN w.equipment_number IS NOT NULL
                             THEN jsonb_build_array(w.equipment_number)
                             ELSE '[]'::jsonb END,
        'status', CASE WHEN w.status_description = ANY (app_open_statuses())
                       THEN 'open' ELSE 'completed' END,
        'statusDetail', w.status_description,
        'staffCode', w.staff_code)
    || CASE WHEN w.required_by IS NOT NULL
            THEN jsonb_build_object('scheduledDate', to_char(w.required_by, 'YYYY-MM-DD'))
            ELSE '{}'::jsonb END
$$;

-- Canonical site record (workorders.py _site_record).
CREATE OR REPLACE FUNCTION app_site_record(s sites) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', s.id, 'customerName', s.customer_name, 'siteName', s.site_name,
        'address', s.address, 'telephone', s.telephone, 'source', s.source,
        'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
$$;

-- OnKey site seed mapped into the record shape (onkey.py _site_seed +
-- workorders.py _site_from_seed: oil company is the customer, blanks stay '').
CREATE OR REPLACE FUNCTION app_site_from_seed(os onkey_sites) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', os.site_number,
        'customerName', coalesce(os.oil_company_name, ''),
        'siteName', coalesce(os.site_name, ''),
        'address', coalesce(os.address, ''),
        'telephone', os.telephone,
        'source', 'onkey', 'updatedAt', NULL, 'inStore', false)
$$;

-- Store-wins site resolution (workorders.py _resolve_site).
CREATE OR REPLACE FUNCTION app_resolve_site(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(
        (SELECT app_site_record(s) FROM sites s WHERE s.id = p_site_id),
        (SELECT app_site_from_seed(os) FROM onkey_sites os WHERE os.site_number = p_site_id))
$$;

-- Canonical dispenser record (workorders.py _dispenser_record).
CREATE OR REPLACE FUNCTION app_dispenser_record(d dispensers) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', d.id, 'siteId', d.site_id, 'make', d.make, 'model', d.model,
        'serialNumber', d.serial_number, 'saApprovalNumber', d.sa_approval_number,
        'status', d.status, 'source', d.source, 'addedBy', d.added_by,
        'addedAt', to_char(d.added_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'retiredBy', d.retired_by,
        'retiredAt', to_char(d.retired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'updatedAt', to_char(d.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'inStore', true)
$$;

-- Equipment seed mapped into the record shape (onkey.py _equipment_seed +
-- workorders.py _dispenser_from_seed: identity blanks completed on-site).
CREATE OR REPLACE FUNCTION app_dispenser_from_seed(e onkey_equipment) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', e.equipment_number, 'siteId', coalesce(e.site_number, ''),
        'make', '', 'model', '', 'serialNumber', '', 'saApprovalNumber', '',
        'status', 'active', 'source', 'onkey', 'addedBy', NULL, 'addedAt', NULL,
        'retiredBy', NULL, 'retiredAt', NULL, 'updatedAt', NULL, 'inStore', false)
$$;

-- Dispensers at a site: store wins, union with seed equipment
-- (workorders.py list_site_dispensers ordering: seed order, then store-only).
CREATE OR REPLACE FUNCTION app_site_dispensers(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH seed_order AS (
        SELECT e.equipment_number AS id, row_number() OVER (ORDER BY e.equipment_number) AS rn
        FROM onkey_equipment e WHERE e.site_number = p_site_id),
    all_ids AS (
        SELECT id, rn FROM seed_order
        UNION ALL
        SELECT d.id, 1000000 + row_number() OVER (ORDER BY d.id)
        FROM dispensers d
        WHERE d.site_id = p_site_id AND d.id NOT IN (SELECT id FROM seed_order))
    SELECT coalesce(jsonb_agg(
        coalesce(
            (SELECT app_dispenser_record(d) FROM dispensers d WHERE d.id = a.id),
            (SELECT app_dispenser_from_seed(e) FROM onkey_equipment e WHERE e.equipment_number = a.id))
        ORDER BY a.rn), '[]'::jsonb)
    FROM all_ids a
$$;

-- ---------------------------------------------------------------------------
-- App-facing RPC (the mobile client calls exactly these)
-- ---------------------------------------------------------------------------

-- GET /v1/technicians/me
CREATE OR REPLACE FUNCTION app_my_technician() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'technician', jsonb_build_object(
            'staffCode', t.staff_code, 'name', t.name,
            'firstName', t.first_name, 'lastName', t.last_name,
            'email', t.email, 'manager', t.manager,
            'pliersNumber', t.pliers_number,
            'measures', coalesce(t.measures, '[]'::jsonb)),
        'editable', lower(coalesce(t.email, '')) = app_email())
    FROM onkey_technicians t
    WHERE t.staff_code = app_staff_code()
$$;

-- GET /v1/workorders (open WOs + site summary, store name wins over seed)
CREATE OR REPLACE FUNCTION app_my_work_orders() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(
        app_wo_seed(w, t.email) || jsonb_build_object('site', jsonb_build_object(
            'id', coalesce(w.site_number, ''),
            'customerName', coalesce(s.customer_name, os.oil_company_name, ''),
            'siteName', coalesce(s.site_name, os.site_name, '')))
        ORDER BY w.required_by NULLS LAST, w.code), '[]'::jsonb)
    FROM onkey_workorders w
    LEFT JOIN onkey_technicians t ON t.staff_code = w.staff_code
    LEFT JOIN sites s ON s.id = w.site_number
    LEFT JOIN onkey_sites os ON os.site_number = w.site_number
    WHERE w.staff_code = app_staff_code()
      AND w.status_description = ANY (app_open_statuses())
$$;

-- GET /v1/workorders/{id} — the bundle; enforces assignment like v1.
CREATE OR REPLACE FUNCTION app_work_order_bundle(wo_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w onkey_workorders;
    t_email text;
    seed jsonb;
BEGIN
    SELECT * INTO w FROM onkey_workorders WHERE code = wo_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order' USING ERRCODE = 'P0404'; END IF;
    SELECT email INTO t_email FROM onkey_technicians WHERE staff_code = w.staff_code;
    IF lower(coalesce(t_email, 'unassigned@prowalco.invalid')) <> app_email()
       AND (app_staff_code() IS NULL OR app_staff_code() <> w.staff_code) THEN
        RAISE EXCEPTION 'Work order is not assigned to you' USING ERRCODE = 'P0403';
    END IF;
    seed := app_wo_seed(w, t_email);
    RETURN jsonb_build_object(
        'workOrder', seed,
        'site', app_resolve_site(w.site_number),
        'dispensers', CASE WHEN w.site_number IS NOT NULL
                           THEN app_site_dispensers(w.site_number)
                           ELSE '[]'::jsonb END);
END $$;

-- GET /v1/sites — sites across the technician's open work orders.
CREATE OR REPLACE FUNCTION app_my_sites() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_resolve_site(sn.site_number) ORDER BY sn.site_number), '[]'::jsonb)
    FROM (SELECT DISTINCT w.site_number
          FROM onkey_workorders w
          JOIN onkey_sites os ON os.site_number = w.site_number
          WHERE w.staff_code = app_staff_code()
            AND w.status_description = ANY (app_open_statuses())) sn
$$;

-- GET /v1/sites/{id}
CREATE OR REPLACE FUNCTION app_site(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT app_resolve_site(p_site_id)
$$;

-- GET /v1/dispensers/{id}
CREATE OR REPLACE FUNCTION app_dispenser(p_dispenser_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(
        (SELECT app_dispenser_record(d) FROM dispensers d WHERE d.id = p_dispenser_id),
        (SELECT app_dispenser_from_seed(e) FROM onkey_equipment e
          WHERE e.equipment_number = p_dispenser_id))
$$;

-- GET /v1/dispensers/{id}/detail (empty register when never saved)
CREATE OR REPLACE FUNCTION app_dispenser_detail(p_dispenser_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(
        (SELECT jsonb_build_object(
            'dispenserId', dd.dispenser_id, 'qMinLpm', dd.q_min_lpm,
            'qMaxLpm', dd.q_max_lpm, 'hoses', coalesce(dd.hoses::jsonb, '[]'::jsonb),
            'updatedAt', to_char(dd.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
         FROM dispenser_details dd WHERE dd.dispenser_id = p_dispenser_id),
        jsonb_build_object('dispenserId', p_dispenser_id, 'qMinLpm', NULL,
                           'qMaxLpm', NULL, 'hoses', '[]'::jsonb))
$$;

-- ---------------------------------------------------------------------------
-- Grants: ONLY the signed-in app may execute the app-facing functions.
-- ---------------------------------------------------------------------------
DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_open_statuses()', 'app_email()', 'app_staff_code()',
        'app_wo_seed(onkey_workorders, text)',
        'app_site_record(sites)', 'app_site_from_seed(onkey_sites)',
        'app_resolve_site(text)',
        'app_dispenser_record(dispensers)', 'app_dispenser_from_seed(onkey_equipment)',
        'app_site_dispensers(text)',
        'app_my_technician()', 'app_my_work_orders()',
        'app_work_order_bundle(text)', 'app_my_sites()', 'app_site(text)',
        'app_dispenser(text)', 'app_dispenser_detail(text)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
