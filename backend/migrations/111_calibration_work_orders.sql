-- 111: the work order knows whether it is calibration work (#167).
--
-- Analysis of 51,131 historical work orders: 4,444 ask for calibration
-- in the work required text, 1,356 for verification, across 1,137 sites,
-- dominated by the recurring "15 monthly calibration" maintenance plans.
-- Where OnKey tasks are known, the *VER task codes (ENGRSAPMVER,
-- PUMA_VER, PINE_VER, PDM_VER) mark the same thing cleanly.
--
-- The app shows the dispenser verification section only on these work
-- orders (owner rule): a leak detector PM has no business offering a
-- verification certificate. Demo work orders always count, so the owner
-- can drive the full flow from a [TEST] job.

CREATE OR REPLACE FUNCTION public.app_wo_row(w work_orders)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $function$
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
        'statusStage', (SELECT s.technician_stage FROM onkey_statuses s
                        WHERE s.code = w.status_code),
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
        'isCalibration', (
            w.is_demo
            OR coalesce(w.work_required, '') ~* 'calib|verif'
            OR EXISTS (SELECT 1 FROM onkey_work_tasks t
                        WHERE t.work_order_code = w.external_ref
                          AND (t.task_code ~* 'ver$'
                               OR t.task_description ~* 'calibrat|verif'))),
        'jobCardSummary', (
            SELECT jsonb_build_object(
                'workPerformed', jc.work_performed,
                'sparesCount', (SELECT coalesce(sum(
                        CASE WHEN p->>'quantity' ~ '^[0-9]+(\.[0-9]+)?$'
                             THEN (p->>'quantity')::numeric ELSE 0 END), 0)
                    FROM jsonb_array_elements(coalesce(jc.parts, '[]'::jsonb)) p),
                'travelledKm', t.distance_km,
                'labourMinutes', round((t.labour_hours + t.labour_ot15 + t.labour_ot20) * 60))
            FROM work_order_job_cards jc,
                 LATERAL job_card_visit_totals(jc.visits) t
            WHERE jc.work_order_id = w.id),
        'lifecycle', (
            SELECT jsonb_build_object(
                'state', coalesce(l.state, 'not_started'),
                'pauseReason', l.pause_reason,
                'pauseNote', l.pause_note,
                'blocksResume', coalesce(r.blocks_resume, false),
                'onTheWayAt', to_char(l.on_the_way_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'startedAt', to_char(l.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedAt', to_char(l.paused_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'stoppedAt', to_char(l.stopped_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'signedOffAt', to_char(l.signed_off_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'),
                'pausedSeconds', coalesce(l.paused_seconds, 0))
            FROM work_order_lifecycle l
            LEFT JOIN work_order_pause_reasons r ON r.code = l.pause_reason
            WHERE l.work_order_id = w.id))
$function$;
