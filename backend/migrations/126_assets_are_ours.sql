-- 126_assets_are_ours.sql (#209)
--
-- Field testing showed the OnKey asset (dispenser) data is not reliable.
-- Owner decision, 22 Aug: switch the OnKey asset side off, delete the
-- OnKey-sourced asset data, and make our own registry THE registry for
-- assets on site. All certificates issued to date are test certificates
-- and go too, so production starts clean.
--
-- Everything deleted is backed up first into purge_2026_08_* tables in
-- this database (locked down like the originals). The signed PDFs in the
-- private storage bucket are left in place, orphaned but harmless.

-- ---------------------------------------------------------------------
-- 1) The read surface stops knowing about the seed.
-- ---------------------------------------------------------------------

-- Store-only site dispenser list; the hoseCount join from 068 survives.
CREATE OR REPLACE FUNCTION app_site_dispensers(p_site_id text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(
        app_dispenser_record(d)
        -- Null, not zero, when the register has never been completed:
        -- "we do not know" and "it has no hoses" are different answers.
        || jsonb_build_object('hoseCount', (
               SELECT jsonb_array_length(dd.hoses)
                 FROM dispenser_details dd
                WHERE dd.dispenser_id = d.id
                  AND jsonb_typeof(dd.hoses) = 'array'))
        ORDER BY d.id), '[]'::jsonb)
    FROM dispensers d
    WHERE d.site_id = p_site_id
$function$;

GRANT EXECUTE ON FUNCTION app_site_dispensers(text) TO authenticated;

-- Store-only single dispenser.
CREATE OR REPLACE FUNCTION app_dispenser(p_dispenser_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT (SELECT app_dispenser_record(d) FROM dispensers d WHERE d.id = p_dispenser_id)
$$;

DROP FUNCTION IF EXISTS app_dispenser_from_seed(onkey_equipment);

-- ---------------------------------------------------------------------
-- 2) Back up, then purge.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS purge_2026_08_certificates       AS SELECT * FROM certificates       WHERE false;
CREATE TABLE IF NOT EXISTS purge_2026_08_audit_events       AS SELECT * FROM audit_events       WHERE false;
CREATE TABLE IF NOT EXISTS purge_2026_08_certificate_emails AS SELECT * FROM certificate_emails WHERE false;
CREATE TABLE IF NOT EXISTS purge_2026_08_dispensers         AS SELECT * FROM dispensers         WHERE false;
CREATE TABLE IF NOT EXISTS purge_2026_08_dispenser_details  AS SELECT * FROM dispenser_details  WHERE false;
CREATE TABLE IF NOT EXISTS purge_2026_08_onkey_equipment    AS SELECT * FROM onkey_equipment    WHERE false;

ALTER TABLE purge_2026_08_certificates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_2026_08_audit_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_2026_08_certificate_emails ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_2026_08_dispensers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_2026_08_dispenser_details  ENABLE ROW LEVEL SECURITY;
ALTER TABLE purge_2026_08_onkey_equipment    ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON purge_2026_08_certificates, purge_2026_08_audit_events,
              purge_2026_08_certificate_emails, purge_2026_08_dispensers,
              purge_2026_08_dispenser_details, purge_2026_08_onkey_equipment
    FROM anon, authenticated;

INSERT INTO purge_2026_08_certificates       SELECT * FROM certificates;
INSERT INTO purge_2026_08_audit_events       SELECT * FROM audit_events;
INSERT INTO purge_2026_08_certificate_emails SELECT * FROM certificate_emails;
INSERT INTO purge_2026_08_dispensers         SELECT * FROM dispensers WHERE source = 'onkey';
INSERT INTO purge_2026_08_dispenser_details
    SELECT dd.* FROM dispenser_details dd
    JOIN dispensers d ON d.id = dd.dispenser_id AND d.source = 'onkey';
INSERT INTO purge_2026_08_onkey_equipment    SELECT * FROM onkey_equipment;

-- Test certificates and their trail. The append-only triggers exist to
-- stop the APPLICATION mutating signed records; this owner-ordered purge
-- of test data suspends them for exactly these statements.
ALTER TABLE certificates DISABLE TRIGGER certificates_append_only;
DELETE FROM certificates;
ALTER TABLE certificates ENABLE TRIGGER certificates_append_only;

ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only;
DELETE FROM audit_events;
ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only;

DELETE FROM certificate_emails;

-- Production numbering starts at 000001 per branch.
DELETE FROM sequence_counters;

-- OnKey-sourced assets, register entries first.
DELETE FROM dispenser_details dd
 USING dispensers d
 WHERE d.id = dd.dispenser_id AND d.source = 'onkey';
DELETE FROM dispensers WHERE source = 'onkey';

-- The mirror the sync no longer writes.
TRUNCATE onkey_equipment;
