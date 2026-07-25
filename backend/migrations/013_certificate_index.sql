-- Architecture v2 phase 4 (#64, #68): the certificate archive is indexed by
-- site + dispenser so the app can show the verification history for every
-- site/dispenser combination. Backfills existing rows from form_json.
-- Idempotent; applied by apply_migrations.py.

ALTER TABLE certificates ADD COLUMN IF NOT EXISTS site_id      varchar(64);
ALTER TABLE certificates ADD COLUMN IF NOT EXISTS dispenser_id varchar(64);
CREATE INDEX IF NOT EXISTS certificates_site_idx      ON certificates (site_id);
CREATE INDEX IF NOT EXISTS certificates_dispenser_idx ON certificates (dispenser_id);

-- Backfill: dispenser straight from the form; site via the canonical
-- dispenser record, else the work order's site. The append-only trigger is
-- suspended ONLY for this schema migration — it fills the new NULL index
-- columns from each row's own form_json and never touches signed content.
ALTER TABLE certificates DISABLE TRIGGER certificates_append_only;

UPDATE certificates
SET dispenser_id = form_json -> 'dispenser' ->> 'dispenserId'
WHERE dispenser_id IS NULL;

UPDATE certificates c
SET site_id = d.site_id
FROM dispensers d
WHERE c.site_id IS NULL AND d.id = c.dispenser_id;

UPDATE certificates c
SET site_id = w.site_number
FROM onkey_workorders w
WHERE c.site_id IS NULL AND w.code = c.form_json ->> 'workOrderId';

ALTER TABLE certificates ENABLE TRIGGER certificates_append_only;

-- History rows for the app: metadata ONLY (no PDF bytes, no full form).
-- Any signed-in technician may see a site's history (owner decision — the
-- history informs the next verification at that site).
CREATE OR REPLACE FUNCTION app_cert_history_row(c certificates) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'certificateNumber', c.certificate_number,
        'siteId', c.site_id,
        'dispenserId', c.dispenser_id,
        'status', c.status,
        'reportType', c.form_json ->> 'reportType',
        'voName', c.form_json -> 'signOff' -> 'vo' -> 'identity' ->> 'name',
        'verificationDate', c.form_json ->> 'verificationDate',
        'expiryDate', c.form_json -> 'signOff' ->> 'expiryDate',
        'signedAt', to_char(c.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'supersedes', c.supersedes)
$$;

CREATE OR REPLACE FUNCTION app_site_history(p_site_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_cert_history_row(c) ORDER BY c.signed_at DESC), '[]'::jsonb)
    FROM certificates c WHERE c.site_id = p_site_id
$$;

CREATE OR REPLACE FUNCTION app_dispenser_history(p_dispenser_id text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_cert_history_row(c) ORDER BY c.signed_at DESC), '[]'::jsonb)
    FROM certificates c WHERE c.dispenser_id = p_dispenser_id
$$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_cert_history_row(certificates)',
        'app_site_history(text)', 'app_dispenser_history(text)'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
