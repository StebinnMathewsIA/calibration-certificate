-- Seed OUR work-order entity from the OnKey register (#95, platform
-- rollout). This is the canonical-store rule applied to work orders: the
-- OnKey row is a SEED, our row is the record, and the lifecycle we own
-- hangs off ours. When OnKey is eventually retired, the seeding stops
-- and nothing else changes.
--
-- Identity fields refresh from the seed on every run; the lifecycle is
-- never touched. Runs every 5 minutes via pg_cron. Idempotent.

CREATE OR REPLACE FUNCTION wo_seed_from_onkey() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
            w.work_required,
            w.status_code,
            w.status_description,
            w.received_on,
            w.required_by,
            w.complete_by,
            s.site_name,
            s.oil_company_name,
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
            w.code, w.staff_code, w.site_number, w.equipment_number, w.work_required,
            w.status_code, w.status_description, w.received_on, w.required_by,
            w.complete_by, s.site_name, s.oil_company_name, s.gps_location
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
END $$;

REVOKE ALL ON FUNCTION wo_seed_from_onkey() FROM PUBLIC;

-- Every 5 minutes, just behind the OnKey sync.
SELECT cron.unschedule('wo-seed-from-onkey')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wo-seed-from-onkey');
SELECT cron.schedule('wo-seed-from-onkey', '*/5 * * * *', 'SELECT wo_seed_from_onkey()');

SELECT wo_seed_from_onkey();
