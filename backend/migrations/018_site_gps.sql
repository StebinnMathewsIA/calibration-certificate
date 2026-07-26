-- Mini map (#73): expose the register GPS through site resolution. The WKT
-- lives in onkey_sites.gps_location (master-enriched, and where #60 manual
-- gap-edits land), so it is merged in even when the canonical store wins.
-- Flows automatically into app_site / bundle / my-sites / sync-pull.
-- Idempotent.

CREATE OR REPLACE FUNCTION app_resolve_site(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN b.base IS NULL THEN NULL ELSE
        b.base || jsonb_build_object('gpsLocation',
            (SELECT os.gps_location FROM onkey_sites os WHERE os.site_number = p_site_id))
    END
    FROM (SELECT coalesce(
        (SELECT app_site_record(s) FROM sites s WHERE s.id = p_site_id),
        (SELECT app_site_from_seed(os) FROM onkey_sites os
          WHERE os.site_number = p_site_id)) AS base) b
$$;

REVOKE ALL ON FUNCTION app_resolve_site(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_resolve_site(text) TO authenticated;
