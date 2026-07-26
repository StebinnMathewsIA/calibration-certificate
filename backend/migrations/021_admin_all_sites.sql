-- Admin/manager site visibility (#76 follow-up, owner request): a role
-- holder with NO view-as selection sees ALL sites on the Sites tab instead
-- of an empty list. With a view-as active, the viewed technician's sites
-- show as before. Idempotent.
CREATE OR REPLACE FUNCTION app_my_sites() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN app_staff_code() IS NULL AND app_role() IS NOT NULL THEN
            coalesce((SELECT jsonb_agg(app_resolve_site(os.site_number)
                                       ORDER BY os.site_number)
                      FROM onkey_sites os), '[]'::jsonb)
        ELSE
            coalesce((SELECT jsonb_agg(app_resolve_site(sn.site_number)
                                       ORDER BY sn.site_number)
                      FROM (SELECT DISTINCT w.site_number
                            FROM onkey_workorders w
                            JOIN onkey_sites os ON os.site_number = w.site_number
                            WHERE w.staff_code = app_staff_code()
                              AND w.status_description = ANY (app_open_statuses())) sn),
                     '[]'::jsonb)
    END
$$;
REVOKE ALL ON FUNCTION app_my_sites() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_my_sites() TO authenticated;
