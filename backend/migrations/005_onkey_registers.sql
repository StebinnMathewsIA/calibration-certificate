-- Registers mined from the WOE001 export (#54, #55): technicians (app
-- users), sites, equipment, and the current state of every work order
-- (latest queue transition per Code). Refreshed by the derivation step at
-- the end of every sync run. Idempotent; applied by apply_migrations.py.

CREATE TABLE IF NOT EXISTS onkey_technicians (
    staff_code varchar(64)  PRIMARY KEY,
    name       varchar(200),
    email      varchar(320),
    updated_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onkey_sites (
    site_number varchar(64)  PRIMARY KEY,
    site_name   varchar(300),
    branch_code varchar(64),
    updated_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS onkey_equipment (
    equipment_number varchar(128) PRIMARY KEY,
    site_number      varchar(64),
    description      varchar(400),
    updated_at       timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onkey_equipment_site_idx ON onkey_equipment (site_number);

CREATE TABLE IF NOT EXISTS onkey_workorders (
    code               varchar(64)  PRIMARY KEY,
    status_code        varchar(64),
    status_description varchar(150),
    status_changed_on  timestamptz,
    staff_code         varchar(64),
    site_number        varchar(64),
    equipment_number   varchar(128),
    received_on        timestamptz,
    required_by        timestamptz,
    complete_by        timestamptz,
    completed_on       timestamptz,
    contract_type      varchar(100),
    work_required      text,
    work_performed     text,
    updated_at         timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onkey_workorders_staff_idx  ON onkey_workorders (staff_code);
CREATE INDEX IF NOT EXISTS onkey_workorders_status_idx ON onkey_workorders (status_description);

-- Supabase exposure lockdown (same rationale as 001-004).
ALTER TABLE onkey_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE onkey_sites       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onkey_equipment   ENABLE ROW LEVEL SECURITY;
ALTER TABLE onkey_workorders  ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_technicians, onkey_sites, onkey_equipment, onkey_workorders
  FROM anon, authenticated;
