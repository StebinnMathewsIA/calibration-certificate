-- Architecture v2 phase 2 (#64, #66): one-round-trip sync pull. Returns the
-- signed-in technician's WHOLE working scope so the device mirror can be
-- refreshed with a single request. Shapes reuse the 010 record builders, so
-- everything matches what the screens already consume.
-- Idempotent; applied by apply_migrations.py.

CREATE OR REPLACE FUNCTION app_sync_pull() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    wos jsonb := app_my_work_orders();
    site_ids text[];
    sites_obj jsonb := '{}'::jsonb;
    disp_obj jsonb := '{}'::jsonb;
    details_obj jsonb;
    sid text;
BEGIN
    SELECT coalesce(array_agg(DISTINCT s.site_id), ARRAY[]::text[]) INTO site_ids
    FROM (SELECT jsonb_array_elements(wos) ->> 'siteId' AS site_id) s
    WHERE s.site_id IS NOT NULL AND s.site_id <> '';

    FOREACH sid IN ARRAY site_ids LOOP
        sites_obj := sites_obj || jsonb_build_object(sid, app_resolve_site(sid));
        disp_obj  := disp_obj  || jsonb_build_object(sid, app_site_dispensers(sid));
    END LOOP;

    SELECT coalesce(jsonb_object_agg(ids.id, app_dispenser_detail(ids.id)), '{}'::jsonb)
      INTO details_obj
    FROM (SELECT DISTINCT elem ->> 'id' AS id
          FROM jsonb_each(disp_obj) AS e(site_key, dispensers),
               jsonb_array_elements(e.dispensers) AS elem) ids
    JOIN dispenser_details dd ON dd.dispenser_id = ids.id;

    RETURN jsonb_build_object(
        'technician', app_my_technician(),
        'workOrders', wos,
        'sites', sites_obj,
        'siteDispensers', disp_obj,
        'dispenserDetails', details_obj,
        'syncedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'));
END $$;

REVOKE ALL ON FUNCTION app_sync_pull() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_sync_pull() TO authenticated;
