-- Work order statuses become DATA, not a guess (#96, PWR-REF01).
--
-- app_open_statuses() has been a hand-written list of six description
-- strings since migration 010. FIELDOPS - STATE now gives us the real
-- register: 53 statuses, each carrying the OnKey base status that says
-- whether it counts as approved, awaiting approval, completed, closed
-- or cancelled.
--
-- Two things the real data corrected:
--   'Referral' (REF) has base status Completed, so we have been treating
--   finished work as open.
--   Work Paused (WPA), Work Stopped (WST), Work Order Signed (WOS),
--   SCT Despatched (SCTD), WO Documents Outstanding (DIS) and Temp
--   UnAllocated (TUA) are all approved work we were hiding.
--
-- Open now means base status 'Approved': approved to be worked, not yet
-- finished. Awaiting Approval is deliberately excluded, it is not the
-- technician's work yet (Awaiting Purchase Order alone is 246 records).
-- IsActive is NOT part of the test: a retired status code can still
-- have live work orders sitting on it.
--
-- Derivation stays in SQL over the snapshot table, per the architecture.
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_statuses (
    code text PRIMARY KEY,
    description text,
    base_status text,
    base_status_description text,
    is_active boolean,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onkey_statuses ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION onkey_statuses_refresh() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    touched int;
BEGIN
    WITH src AS (
        SELECT DISTINCT ON (r.data ->> 'Code')
            r.data ->> 'Code' AS code,
            r.data ->> 'Description' AS description,
            r.data ->> 'BaseStatus' AS base_status,
            r.data ->> 'BaseStatusDescription' AS base_status_description,
            (r.data ->> 'IsActive')::boolean AS is_active
        FROM onkey_report_rows r
        WHERE r.report_code = 'FIELDOPS - STATE'
          AND r.data ->> 'Code' IS NOT NULL
        ORDER BY r.data ->> 'Code', r.last_seen_at DESC
    ), up AS (
        INSERT INTO onkey_statuses AS t
            (code, description, base_status, base_status_description, is_active)
        SELECT code, description, base_status, base_status_description, is_active
        FROM src
        ON CONFLICT (code) DO UPDATE SET
            description = excluded.description,
            base_status = excluded.base_status,
            base_status_description = excluded.base_status_description,
            is_active = excluded.is_active,
            updated_at = now()
        RETURNING 1
    )
    SELECT count(*) INTO touched FROM up;
    RETURN jsonb_build_object('statuses', touched);
END $$;

REVOKE ALL ON FUNCTION onkey_statuses_refresh() FROM PUBLIC;

SELECT onkey_statuses_refresh();

-- Open work, derived. Falls back to the original hand-written list while
-- the register is empty, so a fresh database still behaves.
CREATE OR REPLACE FUNCTION app_open_statuses() RETURNS text[]
LANGUAGE sql STABLE AS $$
    SELECT CASE
        WHEN EXISTS (SELECT 1 FROM onkey_statuses
                     WHERE base_status_description = 'Approved')
        THEN (SELECT array_agg(description ORDER BY description)
              FROM onkey_statuses
              WHERE base_status_description = 'Approved'
                AND description IS NOT NULL)
        ELSE ARRAY['To be Planned','Allocated','Incomplete for Spares',
                   'Work Order Received','Referral','Work Resumed']
    END
$$;

-- Status configuration changes rarely; a daily refresh is plenty.
SELECT cron.unschedule('onkey-statuses-refresh')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-statuses-refresh');
SELECT cron.schedule('onkey-statuses-refresh', '17 2 * * *',
                     'SELECT onkey_statuses_refresh()');

-- Re-seed so work orders on the newly-open statuses appear immediately.
SELECT wo_seed_from_onkey();
