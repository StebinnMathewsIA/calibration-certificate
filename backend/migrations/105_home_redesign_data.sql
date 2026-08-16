-- Data for the Home redesign (#157).
--
-- Three pieces. The estimated duration finally flows: the WOE export has
-- always carried EstimatedDurationInMinutes, our column has existed since
-- 027, and nothing ever connected them (0 of 2,078 real work orders had a
-- value). The mirror gains the column, the seed maps it, and a one-time
-- backfill fills the mirror from the raw store so values appear before
-- the next sync. Second, app_wo_row gains a job card summary (work
-- performed, spares count, travelled, labour) so the Home cards can show
-- outcomes without a per-card fetch. Third, app_home_stats: the day's
-- totals for the signed-in technician, on the Africa/Johannesburg day.
--
-- Idempotent.

ALTER TABLE onkey_workorders ADD COLUMN IF NOT EXISTS estimated_duration_minutes int;

-- One-time backfill from the raw store; the Python mirror upsert carries
-- the field from here on.
UPDATE onkey_workorders o
   SET estimated_duration_minutes = x.est
  FROM (
    SELECT DISTINCT ON (data->>'Code')
           data->>'Code' AS code,
           CASE WHEN data->>'EstimatedDurationInMinutes' ~ '^[0-9]+$'
                THEN (data->>'EstimatedDurationInMinutes')::int END AS est
      FROM onkey_woe001
     WHERE coalesce(data->>'Code', '') <> ''
     ORDER BY data->>'Code', last_seen_at DESC NULLS LAST
  ) x
 WHERE x.code = o.code
   AND o.estimated_duration_minutes IS NULL
   AND x.est IS NOT NULL;

-- Seed: estimated duration joins the identity fields. Regenerated from
-- the live definition, not retyped.
CREATE OR REPLACE FUNCTION public.wo_seed_from_onkey()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    inserted int;
    updated int;
BEGIN
    WITH seed AS (
        SELECT
            w.code,
            w.staff_code,
            w.site_number,
            w.equipment_number,
            onkey_clean(w.work_required) AS work_required,
            w.status_code,
            w.status_description,
            w.received_on,
            w.required_by,
            w.complete_by,
            w.estimated_duration_minutes,
            onkey_clean(s.site_name) AS site_name,
            onkey_clean(s.oil_company_name) AS oil_company_name,
            s.gps_location
        FROM onkey_workorders w
        LEFT JOIN onkey_sites s ON s.site_number = w.site_number
        WHERE w.status_description = ANY (app_open_statuses())
          AND w.code IS NOT NULL
    ), ins AS (
        INSERT INTO work_orders (
            source, external_ref, staff_code, site_id, site_name, customer_name,
            asset_code, work_required, status_code, status_description,
            received_on, required_by, complete_by, estimated_duration_minutes,
            gps_location)
        SELECT
            'onkey', seed.code, seed.staff_code, seed.site_number, seed.site_name,
            seed.oil_company_name, seed.equipment_number, seed.work_required,
            seed.status_code, seed.status_description,
            seed.received_on, seed.required_by, seed.complete_by,
            seed.estimated_duration_minutes, seed.gps_location
        FROM seed
        ON CONFLICT (external_ref) WHERE external_ref IS NOT NULL DO NOTHING
        RETURNING 1
    )
    SELECT count(*) INTO inserted FROM ins;

    -- Identity refresh (never the lifecycle).
    WITH seed AS (
        SELECT
            w.code, w.staff_code, w.site_number, w.equipment_number,
            onkey_clean(w.work_required) AS work_required,
            w.status_code, w.status_description, w.received_on, w.required_by,
            w.complete_by, w.estimated_duration_minutes,
            onkey_clean(s.site_name) AS site_name,
            onkey_clean(s.oil_company_name) AS oil_company_name, s.gps_location
        FROM onkey_workorders w
        LEFT JOIN onkey_sites s ON s.site_number = w.site_number
        WHERE w.code IS NOT NULL
    ), upd AS (
        UPDATE work_orders t SET
            staff_code = seed.staff_code,
            site_id = seed.site_number,
            site_name = coalesce(seed.site_name, t.site_name),
            customer_name = coalesce(seed.oil_company_name, t.customer_name),
            asset_code = coalesce(seed.equipment_number, t.asset_code),
            work_required = coalesce(seed.work_required, t.work_required),
            status_code = seed.status_code,
            status_description = seed.status_description,
            received_on = seed.received_on,
            required_by = seed.required_by,
            complete_by = seed.complete_by,
            estimated_duration_minutes = coalesce(seed.estimated_duration_minutes,
                                                  t.estimated_duration_minutes),
            gps_location = coalesce(seed.gps_location, t.gps_location),
            updated_at = now()
        FROM seed
        WHERE t.external_ref = seed.code
          AND t.source = 'onkey'
          AND (t.status_description IS DISTINCT FROM seed.status_description
               OR t.staff_code IS DISTINCT FROM seed.staff_code
               OR t.complete_by IS DISTINCT FROM seed.complete_by
               OR t.work_required IS DISTINCT FROM seed.work_required
               OR t.estimated_duration_minutes IS DISTINCT FROM
                  coalesce(seed.estimated_duration_minutes, t.estimated_duration_minutes))
        RETURNING 1
    )
    SELECT count(*) INTO updated FROM upd;

    RETURN jsonb_build_object('inserted', inserted, 'refreshed', updated);
END $function$;

-- The row payload gains the job card summary the Home cards read:
-- work performed for the excerpt on paused and complete cards, spares
-- count, travelled and labour. Null when no job card exists yet.
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

/** The four number cards (#157): the signed-in technician's day, on the
 * South African day boundary. Jobs complete counts sign-offs today;
 * spares, travelled and labour sum the job cards SIGNED today, because
 * the signature is when those figures become the record. */
CREATE OR REPLACE FUNCTION app_home_stats()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH today AS (
        SELECT date_trunc('day', now() AT TIME ZONE 'Africa/Johannesburg') AS d
    ), mine AS (
        SELECT w.id FROM work_orders w
        WHERE app_staff_code() IS NOT NULL AND w.staff_code = app_staff_code()
    ), signed_today AS (
        SELECT jc.parts, t.distance_km,
               (t.labour_hours + t.labour_ot15 + t.labour_ot20) AS hours
        FROM work_order_job_cards jc
        JOIN mine m ON m.id = jc.work_order_id,
        LATERAL job_card_visit_totals(jc.visits) t
        WHERE jc.state = 'signed'
          AND date_trunc('day', jc.signed_at AT TIME ZONE 'Africa/Johannesburg')
              = (SELECT d FROM today)
    )
    SELECT jsonb_build_object(
        'jobsComplete', (
            SELECT count(*) FROM work_order_lifecycle l
            JOIN mine m ON m.id = l.work_order_id
            WHERE l.state = 'signed_off'
              AND date_trunc('day', l.signed_off_at AT TIME ZONE 'Africa/Johannesburg')
                  = (SELECT d FROM today)),
        'sparesUsed', (
            SELECT coalesce(sum(
                CASE WHEN p->>'quantity' ~ '^[0-9]+(\.[0-9]+)?$'
                     THEN (p->>'quantity')::numeric ELSE 0 END), 0)
            FROM signed_today s,
                 jsonb_array_elements(coalesce(s.parts, '[]'::jsonb)) p),
        'travelledKm', (SELECT coalesce(sum(distance_km), 0) FROM signed_today),
        'labourHours', (SELECT coalesce(round(sum(hours)::numeric, 1), 0) FROM signed_today));
$function$;

GRANT EXECUTE ON FUNCTION app_home_stats() TO authenticated;

-- Fill the seeded rows immediately rather than on the next status change.
UPDATE work_orders t
   SET estimated_duration_minutes = o.estimated_duration_minutes
  FROM onkey_workorders o
 WHERE t.external_ref = o.code
   AND t.source = 'onkey'
   AND t.estimated_duration_minutes IS NULL
   AND o.estimated_duration_minutes IS NOT NULL;
