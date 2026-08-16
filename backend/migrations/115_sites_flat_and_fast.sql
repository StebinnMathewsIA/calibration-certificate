-- 115: app_my_sites must fit inside the API role's 8 second statement
-- timeout even on a bad night (#171, third round).
--
-- The authenticated role runs with statement_timeout=8s. The register
-- query took 3 to 10 seconds under this evening's write storms because
-- it called two helper functions per row, 2,872 times, so PostgREST
-- kept killing it and the app silently fell back to its six-site
-- cache. One flat join with inline jsonb now: no per-row function
-- calls, field-level store-over-seed resolution, same output shape.

CREATE OR REPLACE FUNCTION public.app_my_sites()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', os.site_number,
            'customerName', coalesce(s.customer_name, os.oil_company_name, ''),
            'siteName', coalesce(s.site_name, os.site_name, ''),
            'address', coalesce(s.address, os.address, ''),
            'telephone', coalesce(s.telephone, os.telephone),
            'contactPerson', s.contact_person,
            'source', coalesce(s.source, 'onkey'),
            'updatedAt', to_char(s.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
            'inStore', s.id IS NOT NULL,
            'gpsLocation', os.gps_location,
            'oilCompany', os.oil_company_name)
        ORDER BY os.site_number), '[]'::jsonb)
    FROM onkey_sites os
    LEFT JOIN sites s ON s.id = os.site_number
$function$;
