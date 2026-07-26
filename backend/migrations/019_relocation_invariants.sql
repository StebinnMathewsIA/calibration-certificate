-- Relocation invariants (#74, owner decision closing v2 phase 7):
-- retire-at-old-site + add-at-new-site IS the relocation flow. A canonical
-- dispenser record (identity, lifecycle) belongs ONLY to its own site; if
-- OnKey re-links the equipment number to another site, the new site sees a
-- blank-identity seed (all assumptions cleared, re-entered on-site), never
-- the old site's record. Certificates were already frozen to the issuing
-- site. Idempotent.

CREATE OR REPLACE FUNCTION app_site_dispensers(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH seed_order AS (
        SELECT e.equipment_number AS id, row_number() OVER (ORDER BY e.equipment_number) AS rn
        FROM onkey_equipment e WHERE e.site_number = p_site_id),
    all_ids AS (
        SELECT id, rn FROM seed_order
        UNION ALL
        SELECT d.id, 1000000 + row_number() OVER (ORDER BY d.id)
        FROM dispensers d
        WHERE d.site_id = p_site_id AND d.id NOT IN (SELECT id FROM seed_order))
    SELECT coalesce(jsonb_agg(
        coalesce(
            -- The canonical record renders ONLY at its own site.
            (SELECT app_dispenser_record(d) FROM dispensers d
              WHERE d.id = a.id AND d.site_id = p_site_id),
            (SELECT app_dispenser_from_seed(e) FROM onkey_equipment e
              WHERE e.equipment_number = a.id))
        ORDER BY a.rn), '[]'::jsonb)
    FROM all_ids a
$$;

REVOKE ALL ON FUNCTION app_site_dispensers(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_site_dispensers(text) TO authenticated;
