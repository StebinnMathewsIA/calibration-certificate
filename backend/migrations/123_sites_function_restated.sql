-- 123: app_my_sites restated, and this time watched (#205).
--
-- The live database was found serving the ANCIENT 021-era definition
-- of app_my_sites (technician-scoped, per-row resolver) even though
-- schema_migrations records 112 through 122 as applied and migration
-- 115's flat all-sites version demonstrably ran. Under work-as the old
-- ELSE branch returned only the technician's work order sites, which
-- is exactly the five-site register the owner photographed. How the
-- function reverted is not yet proven; this migration restates 115's
-- definition verbatim as the newest file, and the recurring sync
-- checks now fingerprint the live function so a future silent revert
-- surfaces within a day instead of on a forecourt.

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
