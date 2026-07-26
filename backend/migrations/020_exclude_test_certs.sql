-- The archive was showing CI test certificates (#75): the live test suite
-- signs real certificates as the provisioned E2E user on every push. Test
-- subjects are now registered in app_test_subjects (seeded from auth.users,
-- and by conftest on every run) and excluded from every user-facing
-- surface. The rows themselves stay (append-only table). Idempotent.

CREATE TABLE IF NOT EXISTS app_test_subjects (subject varchar(200) PRIMARY KEY);
ALTER TABLE app_test_subjects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_test_subjects FROM anon, authenticated;

DO $$
BEGIN
    IF to_regclass('auth.users') IS NOT NULL THEN
        INSERT INTO app_test_subjects (subject)
        SELECT id::text FROM auth.users WHERE email = 'calibration-e2e@example.com'
        ON CONFLICT DO NOTHING;
    END IF;
END $$;

CREATE OR REPLACE FUNCTION app_is_test_subject(p_subject text) RETURNS boolean
LANGUAGE sql STABLE AS $$
    SELECT EXISTS (SELECT 1 FROM app_test_subjects t WHERE t.subject = p_subject)
$$;

CREATE OR REPLACE FUNCTION app_site_history(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_cert_history_row(c) ORDER BY c.signed_at DESC), '[]'::jsonb)
    FROM certificates c
    WHERE c.site_id = p_site_id AND NOT app_is_test_subject(c.technician_subject)
$$;

CREATE OR REPLACE FUNCTION app_dispenser_history(p_dispenser_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_cert_history_row(c) ORDER BY c.signed_at DESC), '[]'::jsonb)
    FROM certificates c
    WHERE c.dispenser_id = p_dispenser_id AND NOT app_is_test_subject(c.technician_subject)
$$;

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
            WHERE NOT app_is_test_subject(c.technician_subject)
              AND (coalesce(trim(p_query), '') = ''
               OR c.certificate_number ILIKE '%' || trim(p_query) || '%'
               OR c.dispenser_id ILIKE '%' || trim(p_query) || '%'
               OR c.site_id ILIKE '%' || trim(p_query) || '%'
               OR coalesce(s.site_name, os.site_name, '') ILIKE '%' || trim(p_query) || '%'
               OR coalesce(s.customer_name, os.oil_company_name, '') ILIKE '%' || trim(p_query) || '%'
               OR (c.form_json -> 'signOff' -> 'vo' -> 'identity' ->> 'name')
                   ILIKE '%' || trim(p_query) || '%')
            ORDER BY c.signed_at DESC
            LIMIT greatest(1, least(coalesce(p_limit, 50), 200))) q),
        '[]'::jsonb)
    END
$$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_is_test_subject(text)', 'app_site_history(text)',
        'app_dispenser_history(text)', 'app_cert_search(text, int)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
