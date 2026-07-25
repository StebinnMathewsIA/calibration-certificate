-- Dormant customer-email pipeline (Arch v2 phase 3, #67). A row is queued at
-- ISSUE time with the sealed PDF's storage ref, which structurally
-- guarantees the copy that eventually goes out is the stored, sealed
-- document. While EMAIL_ENABLED=false (PoC — no @prowalco.co.za sending
-- domain yet) rows are written as 'held'; activating the service later
-- flips the flag and drains held rows without touching the issue path.
-- Idempotent; applied by apply_migrations.py.

CREATE TABLE IF NOT EXISTS certificate_emails (
    id            bigserial PRIMARY KEY,
    certificate_number varchar(64) NOT NULL,
    recipient     varchar(320) NOT NULL,
    client_name   varchar(200),
    storage_ref   varchar(255) NOT NULL,
    status        varchar(16) NOT NULL DEFAULT 'held',  -- held | queued | sent | failed
    error         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    sent_at       timestamptz
);
CREATE INDEX IF NOT EXISTS certificate_emails_status_idx ON certificate_emails (status);
CREATE INDEX IF NOT EXISTS certificate_emails_cert_idx ON certificate_emails (certificate_number);

ALTER TABLE certificate_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON certificate_emails FROM anon, authenticated;
