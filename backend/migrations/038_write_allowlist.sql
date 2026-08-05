-- The OnKey write allowlist, populated (#105).
--
-- This is the control that stops a write touching a real customer's
-- work order. It has been an empty array since migration 026, which
-- meant every write was blocked; that was correct, but it also meant
-- the write path could never be proven.
--
-- These seven are the ONLY work orders Prowalco has designated for
-- write testing (owner, confirmed 2026-08-04 from the OnKey list). The
-- allowlist is absolute: the Edge Function checks it in every mode,
-- including when dry_run is off.
--
-- The "[TEST]#" prefix IS part of the stored code, not a display
-- decoration. That was an open question in WORKORDER-PHASE.md and this
-- settles it: match on the full string.
--
-- They all sit at Completed or Costing Complete, so they do not appear
-- in our work-order mirror, which only carries open statuses. Exercising
-- the visible lifecycle against one still needs Prowalco to move it to
-- an open status, which remains an open ask.
--
-- Kept in a migration rather than typed into the table once, so the
-- list is version-controlled and a change to it shows up in review.
-- Idempotent.

UPDATE onkey_config
SET value = to_jsonb(ARRAY[
        '[TEST]#S00034215',
        '[TEST]#FMC0064304',
        '[TEST]#7067490',
        '[TEST]#7067483',
        '[TEST]#S00033395',
        '[TEST]#7067561',
        '[TEST]#7067605'
    ])
WHERE key = 'write_allowlist';

INSERT INTO onkey_config (key, value)
SELECT 'write_allowlist', to_jsonb(ARRAY[
        '[TEST]#S00034215',
        '[TEST]#FMC0064304',
        '[TEST]#7067490',
        '[TEST]#7067483',
        '[TEST]#S00033395',
        '[TEST]#7067561',
        '[TEST]#7067605'
    ])
WHERE NOT EXISTS (SELECT 1 FROM onkey_config WHERE key = 'write_allowlist');

-- dry_run stays ON. Populating the allowlist does not authorise sending;
-- it only makes the dry-run envelope reachable for these seven.
--
-- SEEDED, NOT ASSERTED. This was an unconditional UPDATE, and
-- apply_migrations.py replays every file on every run with no ledger,
-- while backend-live-tests.yml runs it on every push to main. So each push
-- silently switched writes back off. It cost a real test: a technician
-- drove the whole flow, both hops queued, the drain ran every minute
-- reporting dryRun true, and nothing reached OnKey. The allowlist seed
-- immediately above was already guarded this way; this line was not.
--
-- A fresh database still starts safe. An existing one keeps whatever was
-- deliberately set, because a migration replay is not a decision.
INSERT INTO onkey_config (key, value)
VALUES ('dry_run', to_jsonb(true))
ON CONFLICT (key) DO NOTHING;
