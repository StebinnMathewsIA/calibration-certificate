-- 114: the sites merge must not let an absent store row win (#171).
--
-- app_site_record(s) over a LEFT JOIN's null composite still builds a
-- jsonb, all fields null, and coalesce happily takes it over the OnKey
-- seed, blanking every site that has no store override. Decide on the
-- join key instead.

CREATE OR REPLACE FUNCTION public.app_my_sites()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(
        (CASE WHEN s.id IS NOT NULL THEN app_site_record(s)
              ELSE app_site_from_seed(os) END)
        || jsonb_build_object(
            'gpsLocation', os.gps_location,
            'oilCompany', os.oil_company_name)
        ORDER BY os.site_number), '[]'::jsonb)
    FROM onkey_sites os
    LEFT JOIN sites s ON s.id = os.site_number
$function$;
