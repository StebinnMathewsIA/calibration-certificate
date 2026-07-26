-- View-as hygiene (#77): the WOE001 sync derives a placeholder technician
-- row (staff code UNKNOWN, name "A UNKNOWN") that carries unassigned work
-- orders. It is not a person: it sorted to the top of the view-as picker
-- and was accepted as a view-as target. Exclude it everywhere a person is
-- expected, and clear any selection already pointing at it. Idempotent.

DELETE FROM app_view_as WHERE upper(staff_code) = 'UNKNOWN';

CREATE OR REPLACE FUNCTION app_list_technicians() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS NULL THEN NULL ELSE
        coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'staffCode', t.staff_code, 'name', t.name)
                  ORDER BY t.name NULLS LAST)
                  FROM onkey_technicians t
                  WHERE upper(t.staff_code) <> 'UNKNOWN'), '[]'::jsonb)
    END
$$;

CREATE OR REPLACE FUNCTION app_set_view_as(p_staff_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    em text := app_email();
    r text := app_role();
BEGIN
    IF r IS NULL THEN
        RAISE EXCEPTION 'View-as requires a manager or admin role';
    END IF;
    IF p_staff_code IS NULL OR p_staff_code = '' THEN
        DELETE FROM app_view_as WHERE email = em;
        RETURN app_whoami();
    END IF;
    IF upper(p_staff_code) = 'UNKNOWN'
       OR NOT EXISTS (SELECT 1 FROM onkey_technicians t
                      WHERE t.staff_code = p_staff_code) THEN
        RAISE EXCEPTION 'Unknown technician';
    END IF;
    IF r = 'manager'
       AND EXISTS (SELECT 1 FROM manager_technicians m WHERE m.manager_email = em)
       AND NOT EXISTS (SELECT 1 FROM manager_technicians m
                       WHERE m.manager_email = em AND m.staff_code = p_staff_code) THEN
        RAISE EXCEPTION 'Technician is not in your allocation';
    END IF;
    INSERT INTO app_view_as (email, staff_code) VALUES (em, p_staff_code)
    ON CONFLICT (email) DO UPDATE SET staff_code = EXCLUDED.staff_code, set_at = now();
    RETURN app_whoami();
END $$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_list_technicians()', 'app_set_view_as(text)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
