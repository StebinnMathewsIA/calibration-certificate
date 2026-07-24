-- Master-data enrichment (#59) + manual gap editing (#60).
-- Schema only — master DATA is loaded by the owner via a generated SQL file
-- (never committed: public repo; the technician master contains PII).
-- Idempotent; applied by apply_migrations.py.

-- Staging masters, loaded from AllLocations.xlsx / Technician_Location_Master.xlsx
CREATE TABLE IF NOT EXISTS onkey_location_master (
    code          varchar(120) PRIMARY KEY,   -- e.g. 'ATS010_CHE (38170)'
    description   varchar(300),
    gps_location  varchar(200),               -- WKT 'POINT (lon lat)'
    branch        varchar(16),                -- DBN | JHB | CTN
    address       varchar(400),
    location_code varchar(64),                -- site key (joins onkey_sites.site_number)
    is_active     boolean,
    loaded_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onkey_location_master_loc_idx ON onkey_location_master (location_code);

CREATE TABLE IF NOT EXISTS onkey_technician_master (
    email        varchar(320) PRIMARY KEY,
    display_name varchar(200),
    first_name   varchar(100),
    last_name    varchar(100),
    manager      varchar(200),
    latitude     double precision,
    longitude    double precision,
    loaded_at    timestamptz NOT NULL DEFAULT now()
);

-- Register columns fed by the masters
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS address   varchar(400);
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS telephone varchar(64);
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS is_active boolean;
-- Manual gap edits (#60): field names set by hand — sync never overwrites them.
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS manual_fields jsonb NOT NULL DEFAULT '{}';
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS manual_updated_by varchar(320);
ALTER TABLE onkey_sites ADD COLUMN IF NOT EXISTS manual_updated_at timestamptz;

ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS first_name     varchar(100);
ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS last_name      varchar(100);
ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS manager        varchar(200);
ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS base_latitude  double precision;
ALTER TABLE onkey_technicians ADD COLUMN IF NOT EXISTS base_longitude double precision;

ALTER TABLE onkey_equipment ADD COLUMN IF NOT EXISTS is_active boolean;

-- Supabase exposure lockdown (same rationale as 001-006).
ALTER TABLE onkey_location_master   ENABLE ROW LEVEL SECURITY;
ALTER TABLE onkey_technician_master ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_location_master, onkey_technician_master FROM anon, authenticated;
