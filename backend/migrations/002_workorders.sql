-- Prowalco calibration backend — canonical store for the OnKey object split.
-- Idempotent: safe to re-run. Applied by scripts/apply_migrations.py.
--
-- These are the INTERNAL records we own and persist (see CLAUDE.md object
-- split): our canonical copy of site + dispenser identity (seeded from OnKey
-- when present, completed by the technician when not) and the per-dispenser
-- component register OnKey has no concept of. Unlike certificates/audit_events,
-- these are MUTABLE — identity is corrected over time — so they get RLS
-- lockdown but NO append-only trigger. Issued verifications remain immutable
-- and snapshot identity at signing time, so correcting a record never rewrites
-- history.

CREATE TABLE IF NOT EXISTS sites (
    id            varchar(64)  PRIMARY KEY,
    customer_name varchar(200) NOT NULL,
    site_name     varchar(200) NOT NULL,
    address       varchar(500) NOT NULL,
    telephone     varchar(64),
    source        varchar(16)  NOT NULL,  -- 'onkey' | 'manual'
    updated_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dispensers (
    id                 varchar(64)  PRIMARY KEY,
    site_id            varchar(64)  NOT NULL,
    make               varchar(100) NOT NULL,
    model              varchar(100) NOT NULL,
    serial_number      varchar(100) NOT NULL,
    sa_approval_number varchar(100) NOT NULL,
    status             varchar(16)  NOT NULL DEFAULT 'active',  -- 'active' | 'retired'
    source             varchar(16)  NOT NULL,                   -- 'onkey' | 'manual'
    added_by           varchar(200),
    added_at           timestamptz,
    retired_by         varchar(200),
    retired_at         timestamptz,
    updated_at         timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dispensers_site_idx ON dispensers (site_id);

CREATE TABLE IF NOT EXISTS dispenser_details (
    dispenser_id varchar(64) PRIMARY KEY,
    q_min_lpm    double precision,
    q_max_lpm    double precision,
    hoses        jsonb       NOT NULL DEFAULT '[]',
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Supabase exposure lockdown (same rationale as 001): reachable only through
-- the FastAPI service, never through the auto-generated PostgREST API.
ALTER TABLE sites             ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispensers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE dispenser_details ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON sites, dispensers, dispenser_details FROM anon, authenticated;
