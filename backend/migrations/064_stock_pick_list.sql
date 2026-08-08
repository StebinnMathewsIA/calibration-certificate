-- Make the parts register BROWSABLE, not only searchable (#119).
--
-- An empty query returned an empty list, so the technician tapped the field
-- and saw nothing: indistinguishable from "the register is empty" or "this
-- is broken". A pick list shows you what there is.
--
-- Idempotent.
CREATE OR REPLACE FUNCTION app_stock_search(p_query text, p_limit int DEFAULT 200)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'itemCode', item_code,
               'description', description,
               'unit', unit,
               'vanCount', van_count) ORDER BY rank, van_count DESC, item_code), '[]'::jsonb)
      FROM (
        SELECT s.item_code, s.description, s.unit, s.van_count,
               CASE
                   WHEN coalesce(trim(p_query), '') = '' THEN 0
                   WHEN s.item_code ILIKE p_query || '%' THEN 0
                   WHEN s.item_code ILIKE '%' || p_query || '%' THEN 1
                   ELSE 2
               END AS rank
          FROM stock_items s
         WHERE s.is_active
           AND NOT EXISTS (
                 SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.item_code)
           -- An empty query is not "match nothing", it is "show me the
           -- register". That single condition was the whole bug.
           AND (coalesce(trim(p_query), '') = ''
                OR s.item_code ILIKE '%' || p_query || '%'
                OR s.description ILIKE '%' || p_query || '%')
         ORDER BY rank, s.van_count DESC, s.item_code
         LIMIT greatest(1, least(coalesce(p_limit, 200), 500))
      ) hits;
$function$;

/** How many parts a technician can pick from, so an empty result can say
 * "no match in 507 parts" rather than nothing at all. */
CREATE OR REPLACE FUNCTION app_stock_count()
RETURNS int
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT count(*)::int FROM stock_items s
     WHERE s.is_active
       AND NOT EXISTS (SELECT 1 FROM stock_item_exclusions x WHERE x.item_code = s.item_code);
$function$;

GRANT EXECUTE ON FUNCTION app_stock_search(text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION app_stock_count() TO authenticated;
