-- Decode OnKey text on every seed, not just once (#124).
--
-- Migration 065 cleaned the rows that were already stored. Without this the
-- very next sync would write the escaped text straight back over them, and
-- the fix would appear to work for one minute.
--
-- Regenerated from the live definition rather than retyped, so the seed
-- logic itself is untouched: the only change is onkey_clean() around the
-- text columns we surface.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION public.wo_seed_from_onkey()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    inserted int;
    updated int;
BEGIN
    WITH seed AS (
        SELECT
            w.code,
            w.staff_code,
            w.site_number,
            w.equipment_number,
            onkey_clean(w.work_required) AS work_required,
            w.status_code,
            w.status_description,
            w.received_on,
            w.required_by,
            w.complete_by,
            onkey_clean(s.site_name) AS site_name,
            onkey_clean(s.oil_company_name) AS oil_company_name,
            s.gps_location
        FROM onkey_workorders w
        LEFT JOIN onkey_sites s ON s.site_number = w.site_number
        WHERE w.status_description = ANY (app_open_statuses())
          AND w.code IS NOT NULL
    ), ins AS (
        INSERT INTO work_orders (
            source, external_ref, staff_code, site_id, site_name, customer_name,
            asset_code, work_required, status_code, status_description,
            received_on, required_by, complete_by, gps_location)
        SELECT
            'onkey', seed.code, seed.staff_code, seed.site_number, seed.site_name,
            seed.oil_company_name, seed.equipment_number, seed.work_required,
            seed.status_code, seed.status_description,
            seed.received_on, seed.required_by, seed.complete_by, seed.gps_location
        FROM seed
        ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO inserted FROM ins;

    -- Identity refresh (never the lifecycle).
    WITH seed AS (
        SELECT
            w.code, w.staff_code, w.site_number, w.equipment_number,
            onkey_clean(w.work_required) AS work_required,
            w.status_code, w.status_description, w.received_on, w.required_by,
            w.complete_by, onkey_clean(s.site_name) AS site_name,
            onkey_clean(s.oil_company_name) AS oil_company_name, s.gps_location
        FROM onkey_workorders w
        LEFT JOIN onkey_sites s ON s.site_number = w.site_number
        WHERE w.code IS NOT NULL
    ), upd AS (
        UPDATE work_orders t SET
            staff_code = seed.staff_code,
            site_id = seed.site_number,
            site_name = coalesce(seed.site_name, t.site_name),
            customer_name = coalesce(seed.oil_company_name, t.customer_name),
            asset_code = coalesce(seed.equipment_number, t.asset_code),
            work_required = coalesce(seed.work_required, t.work_required),
            status_code = seed.status_code,
            status_description = seed.status_description,
            received_on = seed.received_on,
            required_by = seed.required_by,
            complete_by = seed.complete_by,
            gps_location = coalesce(seed.gps_location, t.gps_location),
            updated_at = now()
        FROM seed
        WHERE t.external_ref = seed.code
          AND t.source = 'onkey'
          AND (t.status_description IS DISTINCT FROM seed.status_description
               OR t.staff_code IS DISTINCT FROM seed.staff_code
               OR t.complete_by IS DISTINCT FROM seed.complete_by
               OR t.work_required IS DISTINCT FROM seed.work_required)
        RETURNING 1
    )
    SELECT count(*) INTO updated FROM upd;

    RETURN jsonb_build_object('inserted', inserted, 'refreshed', updated);
END $function$
;
