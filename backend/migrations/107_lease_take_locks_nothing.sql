-- 107: a lease probe against a held lease must take no lock (#160).
--
-- The old onkey_take_session_lease used INSERT ... ON CONFLICT DO UPDATE
-- with WHERE expires_at < clock_timestamp(). When the lease was held,
-- the WHERE rejected the update, but ON CONFLICT DO UPDATE locks the
-- conflicting row BEFORE evaluating that WHERE, and the lock lives to
-- the end of the transaction. onkey_kick_patient (migration 104) loops
-- with pg_sleep inside one cron transaction, so its first failed probe
-- pinned the lease row for the whole loop. The running sync then tried
-- to release (an UPDATE on the same row) and blocked on the kick's
-- lock: the kick was waiting for a release that its own probe made
-- impossible. Field evidence was exact: every successful kick in
-- onkey_kick_log was attempts=1, every failure exhausted its attempts,
-- and the recent syncs due at 02:38:00 and 04:12:00 on 2026-08-16
-- started at 02:38:25 and 04:12:16, the moments the kick transactions
-- ended.
--
-- Fix: take the lease with a plain UPDATE. An UPDATE whose WHERE does
-- not match locks nothing, so probing a held lease is free of side
-- effects and the holder can release at any time. The singleton row is
-- seeded here; the INSERT path remains only for an empty table (fresh
-- database), via ON CONFLICT DO NOTHING, which also takes no lock on a
-- conflicting row.

INSERT INTO onkey_session_lease (id, holder, acquired_at, expires_at)
VALUES (true, 'seed', clock_timestamp(), clock_timestamp())
ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION onkey_take_session_lease(p_holder text, p_seconds integer DEFAULT 50)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
    taken boolean;
BEGIN
    UPDATE onkey_session_lease
       SET holder = p_holder,
           acquired_at = clock_timestamp(),
           expires_at = clock_timestamp() + make_interval(secs => p_seconds)
     WHERE id = true AND expires_at < clock_timestamp()
    RETURNING true INTO taken;

    IF taken IS NULL AND NOT EXISTS (SELECT 1 FROM onkey_session_lease WHERE id = true) THEN
        INSERT INTO onkey_session_lease (id, holder, acquired_at, expires_at)
        VALUES (true, p_holder, clock_timestamp(),
                clock_timestamp() + make_interval(secs => p_seconds))
        ON CONFLICT (id) DO NOTHING
        RETURNING true INTO taken;
    END IF;

    RETURN coalesce(taken, false);
END $$;

REVOKE ALL ON FUNCTION onkey_take_session_lease(text, int) FROM anon, authenticated;
