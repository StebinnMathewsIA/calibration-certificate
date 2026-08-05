-- Add [TEST]#FMC0057772 to the OnKey write allowlist (#105).
--
-- The original seven all sit at Completed or Costing Complete, and the
-- Change Status And Queue dialog confirms the transition rules are
-- enforced in the UI exactly as our register predicts: from COSC it
-- offers only APO, INVP, DIS and CLC. So none of them can reach the
-- technician start without a four-hop walk through the approval chain
-- on a costed record, which is not worth doing.
--
-- This one is designated separately for that purpose. Appended rather
-- than replacing, so the original seven stay valid.
--
-- dry_run is untouched and stays ON. Being on the allowlist is
-- permission to build an envelope, not permission to send it.
-- Idempotent.

UPDATE onkey_config
SET value = value || to_jsonb(ARRAY['[TEST]#FMC0057772'])
WHERE key = 'write_allowlist'
  AND NOT (value @> to_jsonb(ARRAY['[TEST]#FMC0057772']));
