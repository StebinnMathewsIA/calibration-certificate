-- Add the second batch of test work orders to the OnKey write allowlist.
--
-- Supplied by the owner 2026-08-05, all five Allocated and therefore able
-- to drive the full on-the-way, start, pause, resume, stop sequence, which
-- the first batch can no longer do: FMC0057772 is stuck at Work Order
-- Received and 10196677 at Work Stopped, and OnKey status changes only go
-- forward.
--
--   [TEST]#7067567  HINDLE ROAD SERVICE STATION
--   [TEST]#7067578  BULT CONVENIENCE CENTRE
--   [TEST]#7067601  SUTHERLAND TRANSPORT PERSEVERANCE
--   [TEST]#7067605  KWAGGASRAND MOTORS      (already allowlisted, inert until now)
--   [TEST]#7067610  FLAMBOYANT GARAGE
--
-- 7067605 was one of the seven original entries that had never appeared in
-- the export. It exists now, so the "inert" seven are not all dead: they
-- were codes waiting to be created. Worth remembering before anyone
-- prunes that list, since removing one would silently revoke permission
-- for a work order that later shows up.
--
-- Appended, never replacing, so earlier grants survive. Idempotent.

UPDATE onkey_config
SET value = value || to_jsonb(ARRAY[
        '[TEST]#7067567',
        '[TEST]#7067578',
        '[TEST]#7067601',
        '[TEST]#7067610'
    ])
WHERE key = 'write_allowlist'
  AND NOT (value @> to_jsonb(ARRAY['[TEST]#7067601']));
