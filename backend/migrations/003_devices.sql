-- Device binding (#51): enrollment register with trust-on-first-use.
-- Idempotent: safe to re-run. Applied by scripts/apply_migrations.py.
--
-- One row per (device, account) pair. The first account to enroll a fresh
-- device becomes its active owner (TOFU); any other account enrolling the
-- same device lands in 'pending' until an admin approves. The public key is
-- the device's enrollment credential: the app signs certificate uploads with
-- the matching private key, so the signing endpoint can cryptographically
-- verify which physical device submitted the package.

CREATE TABLE IF NOT EXISTS devices (
    device_id        varchar(128) NOT NULL,
    subject          varchar(200) NOT NULL,   -- IdP subject (auth identity)
    public_key_pem   text         NOT NULL,
    status           varchar(16)  NOT NULL DEFAULT 'active', -- 'active' | 'pending' | 'revoked'
    platform         varchar(32),
    model            varchar(128),
    technician_email varchar(320),
    enrolled_at      timestamptz  NOT NULL DEFAULT now(),
    approved_by      varchar(200),
    approved_at      timestamptz,
    updated_at       timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (device_id, subject)
);

-- Supabase exposure lockdown (same rationale as 001/002): reachable only
-- through the FastAPI service, never through the auto-generated PostgREST API.
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON devices FROM anon, authenticated;
