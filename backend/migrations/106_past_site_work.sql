-- Past work at this site (#159), for the work order detail redesign.
--
-- Recent completed work orders at the same site as the given one, from
-- OUR records first: reference, when, and a one line "what", preferring
-- the technician's own job card wording over OnKey's, over the original
-- instruction. Same caller rule as the job card: the assigned
-- technician, or anyone on a demo row.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION app_wo_past_site_work(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Unknown work order'; END IF;
    IF NOT w.is_demo AND (app_staff_code() IS NULL OR w.staff_code IS DISTINCT FROM app_staff_code()) THEN
        RAISE EXCEPTION 'This work order is not allocated to you';
    END IF;
    IF coalesce(w.site_id, '') = '' THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'ref', x.ref,
                   'when', to_char(x.done_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'),
                   'what', left(x.what, 200))
               ORDER BY x.done_at DESC)
        FROM (
            SELECT s.external_ref AS ref,
                   coalesce(l.signed_off_at, o.completed_on, s.updated_at) AS done_at,
                   coalesce(nullif(trim(jc.work_performed), ''),
                            nullif(trim(onkey_clean(o.work_performed)), ''),
                            nullif(trim(s.work_required), ''),
                            'No description on record') AS what
            FROM work_orders s
            LEFT JOIN work_order_lifecycle l ON l.work_order_id = s.id
            LEFT JOIN onkey_workorders o ON o.code = s.external_ref
            LEFT JOIN work_order_job_cards jc
                   ON jc.work_order_id = s.id AND jc.state = 'signed'
            WHERE s.site_id = w.site_id
              AND s.id <> w.id
              AND (l.state = 'signed_off' OR o.completed_on IS NOT NULL)
            ORDER BY coalesce(l.signed_off_at, o.completed_on, s.updated_at) DESC
            LIMIT 6
        ) x
    ), '[]'::jsonb);
END $function$;

GRANT EXECUTE ON FUNCTION app_wo_past_site_work(uuid) TO authenticated;
