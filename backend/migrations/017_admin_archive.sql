-- Phase 6 completion (#72): in-app role/allocation administration and the
-- cross-company certificate archive search. Idempotent.

-- Roles list (admin only).
CREATE OR REPLACE FUNCTION app_list_roles() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS DISTINCT FROM 'admin' THEN NULL ELSE
        coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'email', r.email, 'role', r.role,
                    'createdAt', to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
                  ORDER BY r.role, r.email)
                  FROM app_roles r), '[]'::jsonb)
    END
$$;

-- Grant/change/revoke a role (admin only). p_role NULL/'' revokes. The last
-- admin can never be removed or demoted.
CREATE OR REPLACE FUNCTION app_set_role(p_email text, p_role text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    em text := lower(trim(coalesce(p_email, '')));
BEGIN
    IF app_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Role management requires the admin role';
    END IF;
    IF em = '' OR position('@' in em) = 0 THEN
        RAISE EXCEPTION 'A valid email is required';
    END IF;
    IF p_role IS NULL OR p_role = '' THEN
        IF (SELECT count(*) FROM app_roles r WHERE r.role = 'admin' AND r.email <> em) = 0
           AND EXISTS (SELECT 1 FROM app_roles r WHERE r.email = em AND r.role = 'admin') THEN
            RAISE EXCEPTION 'Cannot remove the last admin';
        END IF;
        DELETE FROM app_roles WHERE email = em;
        DELETE FROM manager_technicians WHERE manager_email = em;
    ELSIF p_role NOT IN ('manager', 'admin') THEN
        RAISE EXCEPTION 'role must be manager or admin';
    ELSE
        IF p_role = 'manager'
           AND EXISTS (SELECT 1 FROM app_roles r WHERE r.email = em AND r.role = 'admin')
           AND (SELECT count(*) FROM app_roles r WHERE r.role = 'admin' AND r.email <> em) = 0 THEN
            RAISE EXCEPTION 'Cannot remove the last admin';
        END IF;
        INSERT INTO app_roles (email, role, created_by) VALUES (em, p_role, app_email())
        ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role;
    END IF;
    RETURN app_list_roles();
END $$;

-- Allocations, grouped per manager (admin only).
CREATE OR REPLACE FUNCTION app_list_allocations() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS DISTINCT FROM 'admin' THEN NULL ELSE
        coalesce((SELECT jsonb_object_agg(g.manager_email, g.codes) FROM (
            SELECT m.manager_email, jsonb_agg(m.staff_code ORDER BY m.staff_code) AS codes
            FROM manager_technicians m GROUP BY m.manager_email) g), '{}'::jsonb)
    END
$$;

-- Allocate/deallocate one technician for a manager (admin only).
CREATE OR REPLACE FUNCTION app_set_allocation(p_manager text, p_staff_code text, p_allocated boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    em text := lower(trim(coalesce(p_manager, '')));
BEGIN
    IF app_role() IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Allocation management requires the admin role';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM app_roles r WHERE r.email = em) THEN
        RAISE EXCEPTION 'No role exists for that email — grant one first';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM onkey_technicians t WHERE t.staff_code = p_staff_code) THEN
        RAISE EXCEPTION 'Unknown technician';
    END IF;
    IF p_allocated THEN
        INSERT INTO manager_technicians (manager_email, staff_code)
        VALUES (em, p_staff_code) ON CONFLICT DO NOTHING;
    ELSE
        DELETE FROM manager_technicians WHERE manager_email = em AND staff_code = p_staff_code;
    END IF;
    RETURN app_list_allocations();
END $$;

-- Cross-company certificate search (#72): role holders only. Matches the
-- certificate number, dispenser, site id/name/customer, and VO name.
CREATE OR REPLACE FUNCTION app_cert_search(p_query text, p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS NULL THEN NULL ELSE
        coalesce((SELECT jsonb_agg(row_data) FROM (
            SELECT app_cert_history_row(c)
                   || jsonb_build_object(
                        'siteName', coalesce(s.site_name, os.site_name, ''),
                        'customerName', coalesce(s.customer_name, os.oil_company_name, ''))
                   AS row_data
            FROM certificates c
            LEFT JOIN sites s ON s.id = c.site_id
            LEFT JOIN onkey_sites os ON os.site_number = c.site_id
            WHERE coalesce(trim(p_query), '') = ''
               OR c.certificate_number ILIKE '%' || trim(p_query) || '%'
               OR c.dispenser_id ILIKE '%' || trim(p_query) || '%'
               OR c.site_id ILIKE '%' || trim(p_query) || '%'
               OR coalesce(s.site_name, os.site_name, '') ILIKE '%' || trim(p_query) || '%'
               OR coalesce(s.customer_name, os.oil_company_name, '') ILIKE '%' || trim(p_query) || '%'
               OR (c.form_json -> 'signOff' -> 'vo' -> 'identity' ->> 'name')
                   ILIKE '%' || trim(p_query) || '%'
            ORDER BY c.signed_at DESC
            LIMIT greatest(1, least(coalesce(p_limit, 50), 200))) q),
        '[]'::jsonb)
    END
$$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_list_roles()', 'app_set_role(text, text)',
        'app_list_allocations()', 'app_set_allocation(text, text, boolean)',
        'app_cert_search(text, int)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
