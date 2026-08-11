-- A technician with no van (#131).
--
-- Owner decision 2026-08-11: not everyone who does a job has a van. Someone
-- without one holds no stock, so they have nothing to issue and cannot book
-- spares. Sashern Moodley (staff code 10944) is the case in hand, and the
-- missing suffix on his staff code is not a data gap: it is the truth.
--
-- Three states, because they are three situations and only one is a fault:
--
--   verified     we know the van; spares book against it
--   no_van       confirmed, this person holds no stock. NOT a fault
--   unverified   we do not know, and somebody should look
--
-- Collapsing the middle one into the last is what made a normal fact read
-- as a system failure.
--
-- Idempotent.

ALTER TABLE technician_warehouses
    ADD COLUMN IF NOT EXISTS status varchar(16);

-- Backfill from what verified already meant, before it gains a third value.
UPDATE technician_warehouses
   SET status = CASE WHEN verified THEN 'verified' ELSE 'unverified' END
 WHERE status IS NULL;

ALTER TABLE technician_warehouses
    ALTER COLUMN status SET DEFAULT 'unverified';
ALTER TABLE technician_warehouses
    ALTER COLUMN status SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'technician_warehouses_status_check') THEN
        ALTER TABLE technician_warehouses
            ADD CONSTRAINT technician_warehouses_status_check
            CHECK (status IN ('verified', 'no_van', 'unverified'));
    END IF;
END $$;

-- warehouse_code is null for someone with no van, which the column did not
-- previously allow for.
ALTER TABLE technician_warehouses ALTER COLUMN warehouse_code DROP NOT NULL;

/** The van a costing line books against, or NULL. Unchanged in meaning:
 * only a verified row carries a charge. */
CREATE OR REPLACE FUNCTION costing_warehouse_for(p_staff_code text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT warehouse_code FROM technician_warehouses
     WHERE staff_code = p_staff_code AND status = 'verified';
$function$;

/** Confirmed as holding no stock. Distinct from "we do not know", because
 * one of those is somebody's job to fix and the other is not. */
CREATE OR REPLACE FUNCTION technician_has_no_van(p_staff_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM technician_warehouses
         WHERE staff_code = p_staff_code AND status = 'no_van');
$function$;

/** Record someone as having no van. Manual, because it is a statement
 * about a person that no derivation can make. */
CREATE OR REPLACE FUNCTION technician_set_no_van(p_staff_code text, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    INSERT INTO technician_warehouses (
        staff_code, warehouse_code, source, verified, status,
        technician_name, note, updated_at)
    VALUES (p_staff_code, NULL, 'manual', false, 'no_van',
            (SELECT name FROM onkey_technicians WHERE staff_code = p_staff_code),
            coalesce(p_note, 'confirmed: holds no van stock, so cannot book spares'),
            now())
    ON CONFLICT (staff_code) DO UPDATE SET
        warehouse_code = NULL,
        source = 'manual',
        verified = false,
        status = 'no_van',
        note = EXCLUDED.note,
        updated_at = now();
    RETURN jsonb_build_object('staffCode', p_staff_code, 'status', 'no_van');
END $function$;

/** The refresh must not overwrite a manual statement, and must keep the
 * status column in step with what it derives. */
CREATE OR REPLACE FUNCTION technician_warehouses_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    total int;
    ok int;
    novan int;
BEGIN
    INSERT INTO technician_warehouses (
        staff_code, warehouse_code, source, verified, status,
        technician_name, warehouse_description, note, updated_at)
    SELECT t.staff_code,
           w.code,
           'derived',
           warehouse_names_match(t.name, w.descr),
           CASE WHEN warehouse_names_match(t.name, w.descr) THEN 'verified' ELSE 'unverified' END,
           t.name,
           w.descr,
           CASE WHEN warehouse_names_match(t.name, w.descr) THEN NULL
                ELSE 'the warehouse description does not name this technician; check before booking anything to it'
           END,
           now()
      FROM onkey_technicians t
      JOIN (SELECT DISTINCT data ->> 'WarehouseCode' AS code,
                   data ->> 'WarehouseDescription' AS descr
              FROM onkey_report_rows WHERE report_code = 'FIELDOPS - INV') w
        ON w.code = split_part(t.staff_code, '_', 2)
     WHERE t.staff_code LIKE '%\_%'
    ON CONFLICT (staff_code) DO UPDATE SET
        warehouse_code = EXCLUDED.warehouse_code,
        verified = EXCLUDED.verified,
        status = EXCLUDED.status,
        technician_name = EXCLUDED.technician_name,
        warehouse_description = EXCLUDED.warehouse_description,
        note = EXCLUDED.note,
        updated_at = now()
      WHERE technician_warehouses.source <> 'manual';

    SELECT count(*), count(*) FILTER (WHERE status = 'verified'),
           count(*) FILTER (WHERE status = 'no_van')
      INTO total, ok, novan FROM technician_warehouses;
    RETURN jsonb_build_object('mapped', total, 'verified', ok, 'noVan', novan);
END $function$;

REVOKE ALL ON FUNCTION technician_has_no_van(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION technician_set_no_van(text, text) FROM anon, authenticated;

-- Sashern Moodley, the case that surfaced this.
SELECT technician_set_no_van('10944', 'Confirmed by the owner 2026-08-11: no van, so no spares to book out.');
SELECT technician_warehouses_refresh();
