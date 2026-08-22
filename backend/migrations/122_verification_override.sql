-- 122: the technician can mark any work order as verification work
-- (#200).
--
-- The #167 classifier reads the work required text and the OnKey task
-- codes, but field reality outruns text: "assess and repair" jobs end
-- in a legally required verification once a meter is opened. A manual
-- override column beats widening the regex, because the technician on
-- the forecourt knows, and the override is explicit and auditable
-- (recorded as a work order event by the RPC). NULL means "no opinion,
-- the classifier decides"; true or false wins outright.

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS is_calibration_override boolean;

CREATE OR REPLACE FUNCTION app_wo_set_calibration(p_work_order_id uuid, p_on boolean)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $fn$
BEGIN
    UPDATE work_orders SET is_calibration_override = p_on, updated_at = now()
     WHERE id = p_work_order_id;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'work order not found');
    END IF;
    INSERT INTO work_order_events (work_order_id, event, note, by_email, occurred_at)
    VALUES (p_work_order_id,
            CASE WHEN p_on THEN 'marked_verification' ELSE 'unmarked_verification' END,
            'set by the technician on the work order page', app_email(), now());
    RETURN jsonb_build_object('ok', true, 'isCalibration', p_on);
END $fn$;

GRANT EXECUTE ON FUNCTION app_wo_set_calibration(uuid, boolean) TO authenticated;

-- app_wo_row re-stated from migration 111 with the override folded in.
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
        'isCalibration', coalesce(w.is_calibration_override, (
            w.is_demo
            OR coalesce(w.work_required, '') ~* 'calib|verif'
            OR EXISTS (SELECT 1 FROM onkey_work_tasks t
                        WHERE t.work_order_code = w.external_ref
                          AND (t.task_code ~* 'ver$'
                               OR t.task_description ~* 'calibrat|verif')))),
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
