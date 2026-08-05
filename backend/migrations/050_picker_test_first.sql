-- 050_picker_test_first.sql
--
-- Put the technicians who hold a [TEST] work order at the top of the
-- view-as picker, so the owner can become one and drive the real flow
-- without hunting for them.
--
-- "Test work order" is defined by the code prefix, NOT by the write
-- allowlist, and deliberately so. The two disagree right now: seven of the
-- eight allowlisted codes have never appeared in the export at all, while
-- three test work orders that do exist are absent from it. Keying the
-- picker off the allowlist would therefore hide the very technicians the
-- owner wants to test as. The counts are reported separately so the
-- disagreement is visible in the UI rather than buried.
--
-- Counted from onkey_workorders, not work_orders, so a test job in a
-- status the technician list filters out still puts its holder near the
-- top: you cannot pick someone to test as if they are invisible.

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
                       'openWorkOrders', coalesce(c.n, 0),
                       'testWorkOrders', coalesce(x.n, 0),
                       'writableTestWorkOrders', coalesce(x.writable, 0))
                   ORDER BY coalesce(x.n, 0) DESC,
                            coalesce(c.n, 0) DESC,
                            t.name NULLS LAST)
            FROM onkey_technicians t
            LEFT JOIN (
                SELECT staff_code, count(*) AS n
                  FROM app_visible_work_orders
                 GROUP BY staff_code
            ) c ON c.staff_code = t.staff_code
            LEFT JOIN (
                SELECT o.staff_code,
                       count(*) AS n,
                       count(*) FILTER (
                           WHERE o.code = ANY (ARRAY(
                               SELECT jsonb_array_elements_text(value)
                                 FROM onkey_config WHERE key = 'write_allowlist'))
                       ) AS writable
                  FROM onkey_workorders o
                 WHERE o.code LIKE '[TEST]#%'
                 GROUP BY o.staff_code
            ) x ON x.staff_code = t.staff_code
            WHERE upper(t.staff_code) <> 'UNKNOWN'), '[]'::jsonb)
    END
$function$;
