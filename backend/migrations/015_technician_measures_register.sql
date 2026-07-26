-- Proving measures become a certified register (#70): append-only history
-- per technician, no defaults (all previous prefilled values were
-- unverified — owner decision), verification gates ride the active rows.
-- Idempotent; applied by apply_migrations.py.

CREATE TABLE IF NOT EXISTS technician_measures (
    id                 bigserial PRIMARY KEY,
    staff_code         varchar(64) NOT NULL,
    size               varchar(8)  NOT NULL,   -- 200L | 20L | 5L
    serial_number      varchar(64) NOT NULL,
    certificate_number varchar(64) NOT NULL,
    calibration_date   date,
    expiry_date        date        NOT NULL,
    status             varchar(16) NOT NULL DEFAULT 'active',  -- active | superseded
    added_by           varchar(320),
    created_at         timestamptz NOT NULL DEFAULT now(),
    superseded_at      timestamptz
);
CREATE INDEX IF NOT EXISTS technician_measures_staff_idx
    ON technician_measures (staff_code, status);

ALTER TABLE technician_measures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON technician_measures FROM anon, authenticated;

-- The old jsonb column held unverified prefilled defaults — wipe it. The
-- column stays (deprecated) so old clients don't break; nothing reads it
-- after this migration.
UPDATE onkey_technicians SET measures = '[]'::jsonb
WHERE measures IS DISTINCT FROM '[]'::jsonb;

-- Record shape for the app (camelCase like everything else).
CREATE OR REPLACE FUNCTION app_measure_row(m technician_measures) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', m.id, 'size', m.size,
        'serialNumber', m.serial_number,
        'certificateNumber', m.certificate_number,
        'calibrationDate', to_char(m.calibration_date, 'YYYY-MM-DD'),
        'expiryDate', to_char(m.expiry_date, 'YYYY-MM-DD'),
        'status', m.status,
        'addedAt', to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'supersededAt', to_char(m.superseded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
$$;

-- Active + full history for the signed-in technician (aliases ride the
-- busiest technician like every other read).
CREATE OR REPLACE FUNCTION app_my_measures() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'active', coalesce((SELECT jsonb_agg(app_measure_row(m) ORDER BY m.size)
                            FROM technician_measures m
                            WHERE m.staff_code = app_staff_code() AND m.status = 'active'),
                           '[]'::jsonb),
        'history', coalesce((SELECT jsonb_agg(app_measure_row(m)
                                              ORDER BY m.created_at DESC, m.id DESC)
                             FROM technician_measures m
                             WHERE m.staff_code = app_staff_code()),
                            '[]'::jsonb))
$$;

-- app_my_technician now sources measures from the register table
-- (redefinition of the 010 function; same response shape).
CREATE OR REPLACE FUNCTION app_my_technician() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'technician', jsonb_build_object(
            'staffCode', t.staff_code, 'name', t.name,
            'firstName', t.first_name, 'lastName', t.last_name,
            'email', t.email, 'manager', t.manager,
            'pliersNumber', t.pliers_number,
            'measures', coalesce((SELECT jsonb_agg(app_measure_row(m) ORDER BY m.size)
                                  FROM technician_measures m
                                  WHERE m.staff_code = t.staff_code AND m.status = 'active'),
                                 '[]'::jsonb)),
        'editable', lower(coalesce(t.email, '')) = app_email())
    FROM onkey_technicians t
    WHERE t.staff_code = app_staff_code()
$$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_measure_row(technician_measures)', 'app_my_measures()',
        'app_my_technician()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
