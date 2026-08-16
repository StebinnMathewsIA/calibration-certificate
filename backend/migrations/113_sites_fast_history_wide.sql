-- 113: the sites list gets cheap, and past site work shows everyone's
-- completed jobs (#171, owner findings on device).
--
-- Two problems from the evening's field test, both under a database
-- already straining (see #134 and the sync churn):
--
-- 1. app_my_sites called app_resolve_site 2,872 times per request,
--    each doing three correlated lookups. Fine on a quiet database,
--    but slow enough under load that the phone's refresh timed out and
--    the tab sat on its old six-site cache. One join now does the
--    whole register.
--
-- 2. app_wo_past_site_work only looked in OUR seeded work_orders
--    store, which holds open allocated work, so a site's history shrank
--    to whatever this app had touched. The owner's rule: all completed
--    work at the site shows, no matter whose it was. The OnKey mirror
--    carries that history; it joins in now, deduplicated by reference,
--    our signed job card text preferred when we have it.

CREATE OR REPLACE FUNCTION public.app_my_sites()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(
        coalesce(app_site_record(s), app_site_from_seed(os))
        || jsonb_build_object(
            'gpsLocation', os.gps_location,
            'oilCompany', os.oil_company_name)
        ORDER BY os.site_number)
        FILTER (WHERE coalesce(app_site_record(s), app_site_from_seed(os)) IS NOT NULL),
        '[]'::jsonb)
    FROM onkey_sites os
    LEFT JOIN sites s ON s.id = os.site_number
$function$;

CREATE OR REPLACE FUNCTION public.app_wo_past_site_work(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;
    IF coalesce(w.site_id, '') = '' THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'ref', x.ref,
                   'when', to_char(x.done_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
                   'what', left(x.what, 200))
               ORDER BY x.done_at DESC)
        FROM (
            SELECT d.ref, d.done_at, d.what
            FROM (
            SELECT DISTINCT ON (u.ref) u.ref, u.done_at, u.what
            FROM (
                -- Ours: signed-off work with the job card's own words.
                SELECT s.external_ref AS ref,
                       coalesce(l.signed_off_at, s.updated_at) AS done_at,
                       coalesce(nullif(trim(jc.work_performed), ''),
                                nullif(trim(s.work_required), ''),
                                'No description on record') AS what,
                       1 AS pref
                FROM work_orders s
                LEFT JOIN work_order_lifecycle l ON l.work_order_id = s.id
                LEFT JOIN work_order_job_cards jc
                       ON jc.work_order_id = s.id AND jc.state = 'signed'
                WHERE s.site_id = w.site_id
                  AND s.id <> w.id
                  AND l.state = 'signed_off'
                UNION ALL
                -- Everyone else's: the OnKey mirror's completed work at
                -- this site, whoever did it.
                SELECT o.code,
                       o.completed_on,
                       coalesce(nullif(trim(onkey_clean(o.work_performed)), ''),
                                nullif(trim(onkey_clean(o.work_required)), ''),
                                'No description on record'),
                       2
                FROM onkey_workorders o
                WHERE o.site_number = w.site_id
                  AND o.completed_on IS NOT NULL
                  AND o.code IS DISTINCT FROM w.external_ref
            ) u
            ORDER BY u.ref, u.pref
            ) d
            ORDER BY d.done_at DESC NULLS LAST
            LIMIT 6
        ) x
    ), '[]'::jsonb);
END $function$;
