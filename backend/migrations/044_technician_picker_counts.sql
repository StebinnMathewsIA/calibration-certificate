-- 044_technician_picker_counts.sql
--
-- The view-as picker was alphabetical, which is the wrong order for the
-- job it does: a manager opens it to look at someone who HAS work, and
-- half the register has none. Sort by open work descending and show the
-- count, so the useful names are at the top and the choice is informed.
--
-- Counting needs the same definition of "open" the technician's own list
-- uses, or the picker promises work that the list then does not show.
-- app_visible_work_orders holds that rule ONCE and both read it. It was
-- previously written out longhand inside app_wo_list, which is exactly
-- the kind of duplicate that drifts.

CREATE OR REPLACE VIEW app_visible_work_orders AS
    SELECT w.*,
           s.technician_stage,
           l.state AS lifecycle_state
      FROM work_orders w
      LEFT JOIN onkey_statuses s ON s.code = w.status_code
      LEFT JOIN work_order_lifecycle l ON l.work_order_id = w.id
     WHERE (
             -- Allocated or later: what planning has actually given them.
             s.technician_stage IS NOT NULL
             -- Or work in hand, whatever the office has done to the
             -- status. Nothing vanishes from under someone mid-job.
             OR l.state IN ('on_the_way', 'started', 'paused')
           )
       AND (
             -- Finished work stays for the day only, cut at local
             -- midnight. A new day has a new plan.
             coalesce(s.technician_stage, 0) < app_wo_finished_stage()
             OR coalesce(l.signed_off_at, l.stopped_at, l.updated_at, w.updated_at)
                >= app_day_start()
           );

CREATE OR REPLACE FUNCTION app_wo_list()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    -- Joined back to the table rather than cast from the view: app_wo_row
    -- takes a work_orders row, and a view row is a different type.
    SELECT coalesce(jsonb_agg(
        app_wo_row(w)
        ORDER BY v.technician_stage NULLS LAST, w.complete_by NULLS LAST), '[]'::jsonb)
    FROM work_orders w
    JOIN app_visible_work_orders v ON v.id = w.id
    WHERE app_staff_code() IS NOT NULL
      AND w.staff_code = app_staff_code()
$function$;

CREATE OR REPLACE FUNCTION app_list_technicians()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE WHEN app_role() IS NULL THEN NULL ELSE
        coalesce((
            SELECT jsonb_agg(jsonb_build_object(
                       'staffCode', t.staff_code,
                       'name', t.name,
                       'openWorkOrders', coalesce(c.n, 0))
                   -- Most work first; name breaks ties so the long tail of
                   -- technicians with none stays alphabetical and findable.
                   ORDER BY coalesce(c.n, 0) DESC, t.name NULLS LAST)
            FROM onkey_technicians t
            LEFT JOIN (
                SELECT staff_code, count(*) AS n
                  FROM app_visible_work_orders
                 GROUP BY staff_code
            ) c ON c.staff_code = t.staff_code
            WHERE upper(t.staff_code) <> 'UNKNOWN'), '[]'::jsonb)
    END
$function$;
