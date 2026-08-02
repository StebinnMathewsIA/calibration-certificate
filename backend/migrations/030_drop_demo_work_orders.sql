-- Demo work orders retired (#95): the OnKey seeding (migration 029) put
-- real work orders behind the lifecycle, so the throwaway fixtures and
-- their visible-to-everyone special case are gone. Migration 028 is
-- deleted from the repo so CI can never re-seed them. Idempotent.

DELETE FROM work_orders WHERE is_demo;

-- My work orders: mine by staff code (view-as included), nothing else.
CREATE OR REPLACE FUNCTION app_wo_list() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT coalesce(jsonb_agg(app_wo_row(w) ORDER BY w.complete_by NULLS LAST), '[]'::jsonb)
    FROM work_orders w
    WHERE app_staff_code() IS NOT NULL AND w.staff_code = app_staff_code()
$$;

REVOKE ALL ON FUNCTION app_wo_list() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_wo_list() TO authenticated;
