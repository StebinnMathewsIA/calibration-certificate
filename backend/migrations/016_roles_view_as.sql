-- Phase 6 in-app (#71): roles + view-as replace the demo-alias hack.
-- Idempotent; applied by apply_migrations.py.

CREATE TABLE IF NOT EXISTS app_roles (
    email      varchar(320) PRIMARY KEY,
    role       varchar(16)  NOT NULL,  -- manager | admin
    created_at timestamptz  NOT NULL DEFAULT now(),
    created_by varchar(320)
);
-- First admins: the owner's sign-ins (owner decision, 2026-07-26).
INSERT INTO app_roles (email, role, created_by) VALUES
    ('stebinn@insightsanon.com', 'admin', 'seed'),
    ('stebinn@gmail.com', 'admin', 'seed')
ON CONFLICT (email) DO NOTHING;

-- Technician allocation per manager (admin-managed; empty until assigned).
CREATE TABLE IF NOT EXISTS manager_technicians (
    manager_email varchar(320) NOT NULL,
    staff_code    varchar(64)  NOT NULL,
    PRIMARY KEY (manager_email, staff_code)
);

-- The role holder's current view-as selection.
CREATE TABLE IF NOT EXISTS app_view_as (
    email      varchar(320) PRIMARY KEY,
    staff_code varchar(64)  NOT NULL,
    set_at     timestamptz  NOT NULL DEFAULT now()
);

ALTER TABLE app_roles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_technicians ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_view_as         ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_roles, manager_technicians, app_view_as FROM anon, authenticated;

-- The alias mechanism is gone.
DROP TABLE IF EXISTS app_demo_aliases;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT r.role FROM app_roles r WHERE r.email = app_email()
$$;

-- Resolution v2: a role holder's view-as selection wins; otherwise the
-- direct email match. No more busiest-technician riding.
CREATE OR REPLACE FUNCTION app_staff_code() RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    em text := app_email();
    direct text;
    va text;
BEGIN
    IF em = '' THEN RETURN NULL; END IF;
    SELECT t.staff_code INTO direct FROM onkey_technicians t WHERE lower(t.email) = em LIMIT 1;
    IF EXISTS (SELECT 1 FROM app_roles r WHERE r.email = em) THEN
        SELECT v.staff_code INTO va FROM app_view_as v WHERE v.email = em;
        RETURN coalesce(va, direct);
    END IF;
    RETURN direct;
END $$;

-- Who am I: role + current view-as (name only, for the picker header).
CREATE OR REPLACE FUNCTION app_whoami() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT jsonb_build_object(
        'role', app_role(),
        'viewAsStaffCode', (SELECT v.staff_code FROM app_view_as v WHERE v.email = app_email()),
        'viewAsName', (SELECT t.name FROM app_view_as v
                       JOIN onkey_technicians t ON t.staff_code = v.staff_code
                       WHERE v.email = app_email()))
$$;

-- Technician picker for role holders (names, no emails).
CREATE OR REPLACE FUNCTION app_list_technicians() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS NULL THEN NULL ELSE
        coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'staffCode', t.staff_code, 'name', t.name)
                  ORDER BY t.name NULLS LAST)
                  FROM onkey_technicians t), '[]'::jsonb)
    END
$$;

-- Set/clear view-as. Managers with allocations are limited to them; a
-- manager with no allocations (or an admin) may view any technician.
CREATE OR REPLACE FUNCTION app_set_view_as(p_staff_code text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    em text := app_email();
    r text := app_role();
BEGIN
    IF r IS NULL THEN
        RAISE EXCEPTION 'View-as requires a manager or admin role';
    END IF;
    IF p_staff_code IS NULL OR p_staff_code = '' THEN
        DELETE FROM app_view_as WHERE email = em;
        RETURN app_whoami();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM onkey_technicians t WHERE t.staff_code = p_staff_code) THEN
        RAISE EXCEPTION 'Unknown technician';
    END IF;
    IF r = 'manager'
       AND EXISTS (SELECT 1 FROM manager_technicians m WHERE m.manager_email = em)
       AND NOT EXISTS (SELECT 1 FROM manager_technicians m
                       WHERE m.manager_email = em AND m.staff_code = p_staff_code) THEN
        RAISE EXCEPTION 'Technician is not in your allocation';
    END IF;
    INSERT INTO app_view_as (email, staff_code) VALUES (em, p_staff_code)
    ON CONFLICT (email) DO UPDATE SET staff_code = EXCLUDED.staff_code, set_at = now();
    RETURN app_whoami();
END $$;

-- Measures compliance across technicians (#71): every technician with
-- missing, expired, or soon-expiring certified measures. Role holders only.
CREATE OR REPLACE FUNCTION app_measures_compliance() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN app_role() IS NULL THEN NULL ELSE (
        WITH per_tech AS (
            SELECT t.staff_code, t.name,
                (SELECT coalesce(jsonb_agg(s), '[]'::jsonb) FROM unnest(ARRAY['200L','20L','5L']) s
                 WHERE NOT EXISTS (SELECT 1 FROM technician_measures m
                                   WHERE m.staff_code = t.staff_code AND m.size = s
                                     AND m.status = 'active')) AS missing,
                (SELECT coalesce(jsonb_agg(jsonb_build_object('size', m.size, 'expiryDate',
                            to_char(m.expiry_date, 'YYYY-MM-DD'))), '[]'::jsonb)
                 FROM technician_measures m
                 WHERE m.staff_code = t.staff_code AND m.status = 'active'
                   AND m.expiry_date < current_date) AS expired,
                (SELECT coalesce(jsonb_agg(jsonb_build_object('size', m.size, 'expiryDate',
                            to_char(m.expiry_date, 'YYYY-MM-DD'))), '[]'::jsonb)
                 FROM technician_measures m
                 WHERE m.staff_code = t.staff_code AND m.status = 'active'
                   AND m.expiry_date >= current_date
                   AND m.expiry_date <= current_date + 30) AS expiring
            FROM onkey_technicians t)
        SELECT jsonb_build_object(
            'total', (SELECT count(*) FROM per_tech),
            'compliant', (SELECT count(*) FROM per_tech
                          WHERE missing = '[]'::jsonb AND expired = '[]'::jsonb),
            'issues', coalesce((SELECT jsonb_agg(jsonb_build_object(
                        'staffCode', p.staff_code, 'name', p.name,
                        'missing', p.missing, 'expired', p.expired, 'expiring', p.expiring)
                      ORDER BY (p.missing <> '[]'::jsonb OR p.expired <> '[]'::jsonb) DESC,
                               p.name NULLS LAST)
                      FROM per_tech p
                      WHERE p.missing <> '[]'::jsonb OR p.expired <> '[]'::jsonb
                         OR p.expiring <> '[]'::jsonb), '[]'::jsonb))
    ) END
$$;

DO $$
DECLARE fn text;
BEGIN
    FOREACH fn IN ARRAY ARRAY[
        'app_role()', 'app_staff_code()', 'app_whoami()',
        'app_list_technicians()', 'app_set_view_as(text)',
        'app_measures_compliance()'
    ] LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', fn);
    END LOOP;
END $$;
