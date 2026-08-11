-- Which van a technician's costing books against (#129).
--
-- The answer was in the data all along. An OnKey staff code carries the
-- warehouse code as its suffix:
--
--   JHB050_AA   ->  AA  ->  "VAN - RSAJHB - B. MATHUMBU"   Bongani Mathumbu
--   CTN0044_JE  ->  JE  ->  "VAN - RSACPT - A. MONCHO"     Albert Moncho
--   DBN0105_CK  ->  CK  ->  "VAN - RSADBN - A. MANILALL"   Adil Manilall
--
-- 92 of 100 technicians have a suffix that is a real warehouse code. That
-- is a STRUCTURAL key, not a name match, which is what makes it safe enough
-- to book money against.
--
-- Cobus's Syspro extract (2026-08-08) confirmed the codes are shared
-- between the two systems: 37 of 58 Syspro warehouses appear in OnKey with
-- the same code, and all 37 are vans. Syspro carries the full name where
-- OnKey abbreviates, which is what made the correspondence visible.
--
-- DERIVE, THEN VERIFY, THEN REFUSE. The suffix gives the candidate; the
-- warehouse description has to agree with the technician's name before it
-- is trusted. Where they disagree the row is stored UNVERIFIED and no
-- costing books against it, because a near-miss charges somebody else's
-- van and does it silently. CTN002_BX is exactly that case: the technician
-- register says Fritz van Tonder, warehouse BX says R. FORTAIN.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS technician_warehouses (
    staff_code varchar(64) PRIMARY KEY,
    warehouse_code varchar(16) NOT NULL,
    -- 'derived' from the staff code, 'manual' when someone states it.
    source varchar(16) NOT NULL DEFAULT 'derived',
    -- Only a verified row is allowed to carry a charge.
    verified boolean NOT NULL DEFAULT false,
    technician_name text,
    warehouse_description text,
    note text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE technician_warehouses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON technician_warehouses FROM anon, authenticated;

/** Does the warehouse description name this technician?
 *
 * Any name token of four characters or more, which tolerates the real
 * differences between the two registers: initials ("B. MATHUMBU" for
 * Bongani Mathumbu), reversed order ("SCHOEMAN BEN"), and outright
 * spelling drift ("Noko Moshe" against "NOKO MUSHE"). "VAN" is excluded
 * because every van description starts with it. */
CREATE OR REPLACE FUNCTION warehouse_names_match(p_name text, p_description text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1
          FROM unnest(string_to_array(upper(coalesce(p_name, '')), ' ')) tok
         WHERE length(tok) >= 4
           AND tok <> 'VAN'
           AND upper(coalesce(p_description, '')) LIKE '%' || tok || '%');
$function$;

/** Rebuild the register. Manual rows are never overwritten: somebody
 * stating a mapping outranks anything we work out. */
CREATE OR REPLACE FUNCTION technician_warehouses_refresh()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    total int;
    ok int;
BEGIN
    INSERT INTO technician_warehouses (
        staff_code, warehouse_code, source, verified,
        technician_name, warehouse_description, note, updated_at)
    SELECT t.staff_code,
           w.code,
           'derived',
           warehouse_names_match(t.name, w.descr),
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
        technician_name = EXCLUDED.technician_name,
        warehouse_description = EXCLUDED.warehouse_description,
        note = EXCLUDED.note,
        updated_at = now()
      WHERE technician_warehouses.source <> 'manual';

    SELECT count(*), count(*) FILTER (WHERE verified) INTO total, ok
      FROM technician_warehouses;
    RETURN jsonb_build_object('mapped', total, 'verified', ok);
END $function$;

/** The warehouse a costing line books against, or NULL when we do not
 * know well enough to say. */
CREATE OR REPLACE FUNCTION costing_warehouse_for(p_staff_code text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT warehouse_code FROM technician_warehouses
     WHERE staff_code = p_staff_code AND verified;
$function$;

REVOKE ALL ON FUNCTION technician_warehouses_refresh() FROM anon, authenticated;
REVOKE ALL ON FUNCTION costing_warehouse_for(text) FROM anon, authenticated;

SELECT technician_warehouses_refresh();
