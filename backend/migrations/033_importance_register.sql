-- Real SLA classes replace the invented ones (#107, PWR-REF02 partial).
--
-- FIELDOPS - IMP gives Prowalco's importance register with OnKey's own
-- numeric Weight, higher meaning more urgent:
--
--   003 SLA-Emergency 10 | 002 SLA-Urgent 7 | 004 Other/Manual 5
--   001 SLA-Normal     3 | UNKNOWN         0
--
-- The scheduler has been ranking on HIGH/CRITICAL/MEDIUM/LOW, labels I
-- made up which do not exist in OnKey, so every work order has been
-- falling through to the default weight.
--
-- This is inert until FIELDOPS - WOE carries ImportanceCode: all 300
-- seeded work orders have importance_code NULL today because the
-- current export does not include it. The register and the plumbing go
-- in now so the ranking sharpens the moment that column arrives.
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_importances (
    code text PRIMARY KEY,
    description text,
    weight numeric,
    is_active boolean,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onkey_importances ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION onkey_importances_refresh() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    touched int;
BEGIN
    WITH src AS (
        SELECT DISTINCT ON (r.data ->> 'Code')
            r.data ->> 'Code' AS code,
            r.data ->> 'Description' AS description,
            (r.data ->> 'Weight')::numeric AS weight,
            (r.data ->> 'IsActive')::boolean AS is_active
        FROM onkey_report_rows r
        WHERE r.report_code = 'FIELDOPS - IMP'
          AND r.data ->> 'Code' IS NOT NULL
        ORDER BY r.data ->> 'Code', r.last_seen_at DESC
    ), up AS (
        INSERT INTO onkey_importances AS t (code, description, weight, is_active)
        SELECT code, description, weight, is_active FROM src
        ON CONFLICT (code) DO UPDATE SET
            description = excluded.description,
            weight = excluded.weight,
            is_active = excluded.is_active,
            updated_at = now()
        RETURNING 1
    )
    SELECT count(*) INTO touched FROM up;
    RETURN jsonb_build_object('importances', touched);
END $$;

REVOKE ALL ON FUNCTION onkey_importances_refresh() FROM PUBLIC;

SELECT onkey_importances_refresh();

-- The work order row carries the SLA class and its weight, so ranking
-- reads OnKey's opinion of urgency instead of a client-side guess.
CREATE OR REPLACE FUNCTION app_wo_row(w work_orders) RETURNS jsonb
LANGUAGE sql STABLE AS $$
    SELECT jsonb_build_object(
        'id', w.id,
        'source', w.source,
        'externalRef', w.external_ref,
        'staffCode', w.staff_code,
        'siteId', w.site_id,
        'siteName', w.site_name,
        'customerName', w.customer_name,
        'assetCode', w.asset_code,
        'assetDescription', w.asset_description,
        'workRequired', w.work_required,
        'statusCode', w.status_code,
        'statusDescription', w.status_description,
        'importanceCode', w.importance_code,
        'importanceDescription', (SELECT i.description FROM onkey_importances i
                                  WHERE i.code = w.importance_code),
        'importanceWeight', (SELECT i.weight FROM onkey_importances i
                             WHERE i.code = w.importance_code),
        'estimatedDurationMinutes', w.estimated_duration_minutes,
        'completeBy', to_char(w.complete_by AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'requiredBy', to_char(w.required_by AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
        'gpsLocation', w.gps_location,
        'isDemo', w.is_demo,
        'lifecycle', (
            SELECT jsonb_build_object(
                'state', coalesce(l.state, 'not_started'),
                'pauseReason', l.pause_reason,
                'pauseNote', l.pause_note,
                'blocksResume', coalesce(r.blocks_resume, false),
                'startedAt', to_char(l.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedAt', to_char(l.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'stoppedAt', to_char(l.stopped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedSeconds', coalesce(l.paused_seconds, 0))
            FROM work_order_lifecycle l
            LEFT JOIN work_order_pause_reasons r ON r.code = l.pause_reason
            WHERE l.work_order_id = w.id))
$$;

SELECT cron.unschedule('onkey-importances-refresh')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-importances-refresh');
SELECT cron.schedule('onkey-importances-refresh', '29 2 * * *',
                     'SELECT onkey_importances_refresh()');
