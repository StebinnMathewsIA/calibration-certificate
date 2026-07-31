-- Document types in the archive (#92): the rejection certificate is the
-- first document beyond the verification certificate. Adding a column is
-- DDL, not row mutation, so the append-only trigger is unaffected.
-- Idempotent.

ALTER TABLE certificates
    ADD COLUMN IF NOT EXISTS document_type varchar(32) NOT NULL DEFAULT 'verification';

CREATE OR REPLACE FUNCTION app_cert_history_row(c certificates) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'certificateNumber', c.certificate_number,
        'documentType', c.document_type,
        'siteId', c.site_id,
        'dispenserId', c.dispenser_id,
        'status', c.status,
        'reportType', c.form_json ->> 'reportType',
        'voName', coalesce(
            c.form_json -> 'signOff' -> 'vo' -> 'identity' ->> 'name',
            c.form_json -> 'vo' -> 'identity' ->> 'name'),
        'verificationDate', coalesce(
            c.form_json ->> 'verificationDate',
            c.form_json ->> 'rejectionDate'),
        'expiryDate', c.form_json -> 'signOff' ->> 'expiryDate',
        'signedAt', to_char(c.signed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'supersedes', c.supersedes)
$$;
