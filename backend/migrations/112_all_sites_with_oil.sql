-- 112: every site on the Sites tab, with its oil company (#168).
--
-- Technicians used to see only the sites carrying their open work, which
-- made the tab useless for pulling up documents or past work anywhere
-- else. The full register goes to everyone now (the app puts their
-- active sites on top), and each site carries oil_company_name so the
-- tab can filter and brand the discs. Managers already got the full
-- list; the two branches collapse into one.

CREATE OR REPLACE FUNCTION public.app_my_sites()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce((SELECT jsonb_agg(
                app_resolve_site(os.site_number)
                || jsonb_build_object('oilCompany', os.oil_company_name)
                ORDER BY os.site_number)
            FROM onkey_sites os), '[]'::jsonb)
$function$;
