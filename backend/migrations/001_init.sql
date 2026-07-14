-- Prowalco calibration backend — Postgres schema (production)
-- Dev/SQLite uses SQLAlchemy create_all; this migration is the production
-- source of truth, including the append-only lockdown of the audit table.

BEGIN;

CREATE TABLE certificates (
    id                  uuid PRIMARY KEY,
    certificate_number  varchar(64)  NOT NULL UNIQUE,
    idempotency_key     uuid         NOT NULL UNIQUE,
    status              varchar(16)  NOT NULL DEFAULT 'issued',
    technician_subject  varchar(200) NOT NULL,
    form_json           jsonb        NOT NULL,
    unsigned_pdf_sha256 char(64)     NOT NULL,
    signed_pdf_sha256   char(64)     NOT NULL,
    -- PoC keeps the signed PDF in the DB; production should move it to
    -- write-once object storage (e.g. S3 with Object Lock) and keep only the
    -- storage reference + hash here.
    signed_pdf          bytea        NOT NULL,
    signature_id        varchar(64)  NOT NULL,
    signed_at           timestamptz  NOT NULL,
    supersedes          varchar(64),
    created_at          timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
    id                  uuid PRIMARY KEY,
    certificate_number  varchar(64)  NOT NULL,
    event_type          varchar(64)  NOT NULL,
    actor_subject       varchar(200) NOT NULL,
    payload             jsonb        NOT NULL,
    created_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_cert_idx ON audit_events (certificate_number, created_at);

CREATE TABLE sequence_counters (
    branch      varchar(8) PRIMARY KEY,
    next_value  integer NOT NULL DEFAULT 1
);

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
-- The application connects as prowalco_app, which can INSERT and SELECT audit
-- events but can never UPDATE or DELETE them. Signed certificates are also
-- immutable: amendments create a NEW certificate number that supersedes the
-- old one (see docs/e-signature-procedure.md).

-- CREATE ROLE prowalco_app LOGIN;  -- provisioned by infra, shown for clarity
GRANT SELECT, INSERT ON audit_events TO prowalco_app;
REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM prowalco_app;

GRANT SELECT, INSERT ON certificates TO prowalco_app;
REVOKE UPDATE, DELETE, TRUNCATE ON certificates FROM prowalco_app;

GRANT SELECT, INSERT, UPDATE ON sequence_counters TO prowalco_app;

-- Belt-and-braces: block UPDATE/DELETE at the table level regardless of role.
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_events_append_only
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TRIGGER certificates_append_only
    BEFORE UPDATE OR DELETE ON certificates
    FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

COMMIT;
