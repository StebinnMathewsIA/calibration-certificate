-- Decode OnKey's HTML-escaped text ONCE, on the way in (#124).
--
-- The export delivers WorkRequired already escaped, and we escaped it again
-- on the way out, so the first real job card printed
--
--   "pumps 1, 2, 3 &amp; 4 on ULP 95 &amp; ULP 93 ...
--    repair.&#10;&#10;Last_Work_Order: ..."
--
-- to a customer. Fixing it in the PDF template would have left the app
-- screen wrong; fixing it in both would leave the next consumer to
-- rediscover it. So it is normalised here, at the boundary, and every
-- reader downstream gets clean text.
--
-- Decoding an entity is not editing the text. The words are Prowalco's and
-- are not touched.
--
-- Idempotent.

/** The entities the OnKey export actually produces, plus the numeric forms
 * for the two whitespace characters that appear in practice. Deliberately
 * NOT a general HTML decoder: this runs on every synced row and a broad
 * regex over free text is how a genuine "&" in "R&D" gets mangled.
 *
 * Order matters. &amp; is decoded LAST, otherwise "&amp;lt;" becomes "<"
 * instead of the literal "&lt;" it was meant to be. */
CREATE OR REPLACE FUNCTION onkey_decode_text(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE WHEN p_text IS NULL THEN NULL ELSE
        btrim(
          regexp_replace(
            replace(
              replace(
                replace(
                  replace(
                    replace(
                      replace(p_text, '&#10;', E'\n'),
                    '&#13;', ''),
                  '&quot;', '"'),
                '&#39;', ''''),
              '&lt;', '<'),
            '&gt;', '>'),
          -- OnKey stores addresses as "BRENTWOOD PARK ,7100 ,WESTERN CAPE".
          -- A space before a comma is not punctuation anybody chose.
          '\s+,', ',', 'g')
        )
    END;
$function$;

/** &amp; last, as a separate step so the ordering above cannot be reordered
 * by accident. */
CREATE OR REPLACE FUNCTION onkey_clean(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT replace(onkey_decode_text(p_text), '&amp;', '&');
$function$;

REVOKE ALL ON FUNCTION onkey_decode_text(text) FROM anon, authenticated;
REVOKE ALL ON FUNCTION onkey_clean(text) FROM anon, authenticated;

-- Clean what is already stored. Signed documents are never re-rendered, so
-- this only affects what is printed from here on.
UPDATE work_orders
   SET work_required = onkey_clean(work_required),
       site_name = onkey_clean(site_name),
       customer_name = onkey_clean(customer_name),
       asset_description = onkey_clean(asset_description)
 WHERE work_required LIKE '%&%' OR site_name LIKE '%&%'
    OR customer_name LIKE '%&%' OR asset_description LIKE '%&%'
    OR site_name LIKE '% ,%' OR asset_description LIKE '% ,%';

UPDATE onkey_sites
   SET address = onkey_clean(address),
       site_name = onkey_clean(site_name),
       oil_company_name = onkey_clean(oil_company_name)
 WHERE address LIKE '%&%' OR address LIKE '% ,%'
    OR site_name LIKE '%&%' OR oil_company_name LIKE '%&%';
