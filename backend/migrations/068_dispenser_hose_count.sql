-- Hose count on the dispenser list (#123).
--
-- A technician reading a work order before driving out wants to know what
-- they will find: whose dispenser, which model, how many hoses, therefore
-- which parts to load and how long it will take. We hold all of it, but the
-- hose count lived only in the component register, which is reachable only
-- after arriving and picking a dispenser.
--
-- Added to the list RPC rather than fetched per dispenser: a site with
-- eight dispensers would otherwise be eight round trips at a forecourt.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION app_site_dispensers(p_site_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
        -- Hoses come from the component register. Null, not zero, when the
        -- register has never been completed: "we do not know" and "it has
        -- no hoses" are different answers and a technician planning a visit
        -- needs to tell them apart.
        || jsonb_build_object('hoseCount', (
               SELECT jsonb_array_length(dd.hoses)
                 FROM dispenser_details dd
                WHERE dd.dispenser_id = a.id
                  AND jsonb_typeof(dd.hoses) = 'array'))
        ORDER BY a.rn), '[]'::jsonb)
    FROM all_ids a
$function$;

GRANT EXECUTE ON FUNCTION app_site_dispensers(text) TO authenticated;
