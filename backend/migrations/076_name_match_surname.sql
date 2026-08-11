-- Accept an exact surname as well (#129, follow-up to 075).
--
-- The four-character token rule was too strict in one direction. Clinton
-- May against "VAN - RSAJHB - C. MAY" is plainly the same person, and the
-- only shared token is three characters long, so it was left unverified
-- and his costing would have been held for no reason.
--
-- Lowering the threshold to three would let short accidental tokens match.
-- Instead the last name is compared as a WHOLE WORD, which is precise
-- rather than loose: "MAY" matches "C. MAY" and does not match "MAYFAIR".
--
-- The genuinely wrong ones stay unverified, which is the point: six vans
-- name a different technician entirely, and those are a real discrepancy
-- between the two registers rather than a matching problem.
--
-- Idempotent.

CREATE OR REPLACE FUNCTION warehouse_names_match(p_name text, p_description text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        -- Any substantial token, which tolerates initials, reversed order
        -- and spelling drift between the two registers.
        EXISTS (
            SELECT 1
              FROM unnest(string_to_array(upper(coalesce(p_name, '')), ' ')) tok
             WHERE length(tok) >= 4
               AND tok <> 'VAN'
               AND upper(coalesce(p_description, '')) LIKE '%' || tok || '%')
        -- Or the surname exactly, as a whole word, for the short ones.
        OR (
            coalesce(p_name, '') <> ''
            AND upper(coalesce(p_description, '')) ~ (
                '\m' || upper(regexp_replace(
                    split_part(p_name, ' ', array_length(string_to_array(p_name, ' '), 1)),
                    '[^A-Za-z]', '', 'g')) || '\M'));
$function$;

SELECT technician_warehouses_refresh();
