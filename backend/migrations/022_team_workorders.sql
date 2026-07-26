-- Home team view (#76): open work orders grouped per technician for role
-- holders (manager: allocated team, or everyone while unallocated; admin:
-- everyone). Also lets role holders OPEN those work orders. Idempotent.
CREATE OR REPLACE FUNCTION app_team_work_orders() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS NULL THEN NULL ELSE
        coalesce((SELECT jsonb_agg(jsonb_build_object(
            'staffCode', g.staff_code, 'name', g.name, 'workOrders', g.wos)
            ORDER BY g.name NULLS LAST)
        FROM (
            SELECT w.staff_code, t.name,
                jsonb_agg(app_wo_seed(w, t.email) || jsonb_build_object(
                    'site', jsonb_build_object(
                        'id', coalesce(w.site_number, ''),
                        'customerName', coalesce(s.customer_name, os.oil_company_name, ''),
                        'siteName', coalesce(s.site_name, os.site_name, '')))
                    ORDER BY w.required_by NULLS LAST, w.code) AS wos
            FROM onkey_workorders w
            JOIN onkey_technicians t ON t.staff_code = w.staff_code
            LEFT JOIN sites s ON s.id = w.site_number
            LEFT JOIN onkey_sites os ON os.site_number = w.site_number
            WHERE w.status_description = ANY (app_open_statuses())
              AND (app_role() = 'admin'
                   OR NOT EXISTS (SELECT 1 FROM manager_technicians m
                                  WHERE m.manager_email = app_email())
                   OR EXISTS (SELECT 1 FROM manager_technicians m
                              WHERE m.manager_email = app_email()
                                AND m.staff_code = w.staff_code))
            GROUP BY w.staff_code, t.name) g), '[]'::jsonb)
    END
$$;

-- Role holders may open any work order they can see in the team view.
CREATE OR REPLACE FUNCTION app_work_order_bundle(wo_code text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    w onkey_workorders;
    t_email text;
BEGIN
    SELECT * INTO w FROM onkey_workorders WHERE code = wo_code;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order' USING ERRCODE = 'P0404'; END IF;
    SELECT email INTO t_email FROM onkey_technicians WHERE staff_code = w.staff_code;
    IF lower(coalesce(t_email, 'unassigned@prowalco.invalid')) <> app_email()
       AND (app_staff_code() IS NULL OR app_staff_code() <> w.staff_code)
       AND (app_role() IS NULL
            OR (app_role() = 'manager'
                AND EXISTS (SELECT 1 FROM manager_technicians m
                            WHERE m.manager_email = app_email())
                AND NOT EXISTS (SELECT 1 FROM manager_technicians m
                                WHERE m.manager_email = app_email()
                                  AND m.staff_code = w.staff_code))) THEN
        RAISE EXCEPTION 'Work order is not assigned to you' USING ERRCODE = 'P0403';
    END IF;
    RETURN jsonb_build_object(
        'workOrder', app_wo_seed(w, t_email),
        'site', app_resolve_site(w.site_number),
        'dispensers', CASE WHEN w.site_number IS NOT NULL
                           THEN app_site_dispensers(w.site_number)
                           ELSE '[]'::jsonb END);
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY['app_team_work_orders()', 'app_work_order_bundle(text)'] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
