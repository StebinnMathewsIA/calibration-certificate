-- Prowalco calibration backend — Supabase Postgres schema.
-- Idempotent: safe to re-run. Applied by scripts/apply_migrations.py (which
-- owns the transaction) or by pasting into the Supabase SQL editor.

CREATE TABLE IF NOT EXISTS certificates (
    id                  uuid PRIMARY KEY,
    certificate_number  varchar(64)  NOT NULL UNIQUE,
    idempotency_key     uuid         NOT NULL UNIQUE,
    status              varchar(16)  NOT NULL DEFAULT 'issued',
    technician_subject  varchar(200) NOT NULL,
    form_json           jsonb        NOT NULL,
    unsigned_pdf_sha256 char(64)     NOT NULL,
    signed_pdf_sha256   char(64)     NOT NULL,
    -- The signed PDF lives in the private "certificates" Storage bucket;
    -- storage_ref is the object path.
    storage_ref         varchar(255) NOT NULL,
    signature_id        varchar(64)  NOT NULL,
    signed_at           timestamptz  NOT NULL,
    supersedes          varchar(64),
    created_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_events (
    id                  uuid PRIMARY KEY,
    certificate_number  varchar(64)  NOT NULL,
    event_type          varchar(64)  NOT NULL,
    actor_subject       varchar(200) NOT NULL,
    payload             jsonb        NOT NULL,
    created_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_events_cert_idx
    ON audit_events (certificate_number, created_at);

CREATE TABLE IF NOT EXISTS sequence_counters (
    branch      varchar(8) PRIMARY KEY,
    next_value  integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Supabase exposure lockdown
-- ---------------------------------------------------------------------------
-- These tables must ONLY be reachable through the FastAPI signing service
-- (which connects with the Postgres connection string), never through
-- Supabase's auto-generated PostgREST API. Enabling RLS with no policies
-- denies all access to the API roles (anon / authenticated); the table owner
-- used by the backend is unaffected.
ALTER TABLE certificates      ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sequence_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON certificates, audit_events, sequence_counters FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
-- Signed certificates and audit events are immutable: amendments create a
-- NEW certificate number that supersedes the old one
-- (docs/e-signature-procedure.md). The trigger applies to every role,
-- including the backend's own connection — there is no update path at all.

CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_append_only ON audit_events;
CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DROP TRIGGER IF EXISTS certificates_append_only ON certificates;
CREATE TRIGGER certificates_append_only
    BEFORE UPDATE OR DELETE ON certificates
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Optional hardening: run the backend as a dedicated least-privilege role
-- instead of the default postgres user. Uncomment and set a password, then
-- use that role in DATABASE_URL.
-- CREATE ROLE prowalco_app LOGIN PASSWORD '...';
-- GRANT USAGE ON SCHEMA public TO prowalco_app;
-- GRANT SELECT, INSERT ON certificates, audit_events TO prowalco_app;
-- GRANT SELECT, INSERT, UPDATE ON sequence_counters TO prowalco_app;
