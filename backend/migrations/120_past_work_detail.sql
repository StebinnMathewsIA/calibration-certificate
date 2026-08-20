-- 120: full detail for one past work order at a site (#192).
--
-- The "Past work at this site" rows carried a two-line summary; the
-- FieldOps mirror holds the whole story. A keyed lookup on the
-- register, joined to the technician roster for the name, feeds the
-- tap-through detail screen. NULL when the reference is unknown (for
-- example the [TEST]# entities that exist only in our store): the app
-- then keeps its summary and says OnKey has no further detail.

CREATE OR REPLACE FUNCTION app_wo_past_work_detail(p_ref text)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT jsonb_build_object(
        'ref', w.code,
        'status', w.status_description,
        'technician', coalesce(nullif(trim(t.name), ''), w.staff_code),
        'receivedOn', w.received_on,
        'completedOn', w.completed_on,
        'assetCode', w.equipment_number,
        'workRequired', nullif(trim(onkey_clean(w.work_required)), ''),
        'workPerformed', nullif(trim(onkey_clean(w.work_performed)), ''))
    FROM onkey_workorders w
    LEFT JOIN onkey_technicians t ON t.staff_code = w.staff_code
    WHERE w.code = p_ref;
$function$;

GRANT EXECUTE ON FUNCTION app_wo_past_work_detail(text) TO authenticated;
