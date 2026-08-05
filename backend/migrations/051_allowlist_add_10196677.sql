-- Add [TEST]#10196677 to the OnKey write allowlist (#105).
--
-- Needed because there is currently no way to test a technician's job from
-- the beginning. [TEST]#FMC0057772 was moved to WOR by the first live
-- write and OnKey does not allow WOR back to ALC: the only transitions out
-- are CPD, TBC, WPA and WST, all forward. So start can no longer be
-- exercised on it without a planner intervening in the OnKey UI.
--
-- [TEST]#10196677 is Allocated and held by Sashern Moodley, which makes it
-- the only test work order that can drive the full on-the-way, start,
-- pause, stop sequence.
--
-- Worth recording about the rest of the allowlist: seven of its eight
-- entries have NEVER appeared in the OnKey export (zero rows in
-- onkey_woe001). They are inert, so they are left alone rather than
-- cleaned up in the same change that grants a new permission. Meanwhile
-- [TEST]#7067030 and [TEST]#R00226002 do exist but sit at Costing
-- Complete, which per migration 039 cannot reach a technician start
-- without walking the approval chain on a costed record.
--
-- NOTE: dry_run is currently OFF. Unlike every previous allowlist change,
-- this one takes effect immediately: a lifecycle action on this work order
-- will reach OnKey. That is the intent, and it is the reason the entry is
-- named rather than the prefix being wildcarded.
-- Idempotent.

UPDATE onkey_config
SET value = value || to_jsonb(ARRAY['[TEST]#10196677'])
WHERE key = 'write_allowlist'
  AND NOT (value @> to_jsonb(ARRAY['[TEST]#10196677']));
