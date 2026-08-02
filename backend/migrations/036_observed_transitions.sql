-- What OnKey ALLOWS versus what OnKey DOES (#96). A correction.
--
-- Migration 032 read ApplyTargetStatusRules = true on every status and
-- concluded that wrkWorkOrderTargetStatuses is enforced. Two months of
-- real transitions from FIELDOPS - QUEUE say otherwise: of 25 distinct
-- transitions actually performed, only 15 appear in the target register.
-- The single most common transition in the whole window, DOCARC -> CLC
-- with 647 occurrences, is not in it at all, and neither are
-- COSC -> WCF (80), ALC -> TBP (28) or CPD -> WCF (13).
--
-- So the target register is not a complete description of what OnKey
-- permits. Something bypasses it: an automated job, an admin path, or a
-- rule that applies per role rather than per status. The unregistered
-- transitions are all office and costing ones (document archiving,
-- closing, cancelling, purchase orders), never technician ones.
--
-- What this does NOT change: every transition our own write scope needs
-- IS in the register and was verified against it. WOR -> WPA -> LSI,
-- WPA -> WRE, WST -> WOS all pass; LSI -> WRE is correctly refused. Our
-- gate stays strict, because for the narrow set of moves we make, the
-- register has proven right.
--
-- What it DOES change: the gate is a safety rail for our own writes, not
-- evidence about what OnKey will accept in general. This table records
-- what actually happens so the difference stays visible instead of
-- becoming a surprise later.
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_status_transitions_observed (
    from_code text NOT NULL,
    to_code text NOT NULL,
    occurrences int NOT NULL DEFAULT 0,
    in_target_register boolean,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_code, to_code)
);

ALTER TABLE onkey_status_transitions_observed ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION onkey_observed_transitions_refresh() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    touched int;
    unregistered int;
BEGIN
    WITH src AS (
        SELECT
            r.data ->> 'OldStatusCode' AS from_code,
            r.data ->> 'NewStatusCode' AS to_code,
            count(*)::int AS occurrences
        FROM onkey_report_rows r
        WHERE r.report_code = 'FIELDOPS - QUEUE'
          AND r.data ->> 'OldStatusCode' IS NOT NULL
          AND r.data ->> 'NewStatusCode' IS NOT NULL
        GROUP BY 1, 2
    ), up AS (
        INSERT INTO onkey_status_transitions_observed AS t
            (from_code, to_code, occurrences, in_target_register)
        SELECT from_code, to_code, occurrences,
               onkey_transition_allowed(from_code, to_code)
        FROM src
        ON CONFLICT (from_code, to_code) DO UPDATE SET
            occurrences = excluded.occurrences,
            in_target_register = excluded.in_target_register,
            last_seen_at = now()
        RETURNING 1
    )
    SELECT count(*) INTO touched FROM up;

    SELECT count(*) INTO unregistered
    FROM onkey_status_transitions_observed
    WHERE NOT coalesce(in_target_register, false);

    RETURN jsonb_build_object('observed', touched, 'notInTargetRegister', unregistered);
END $$;

REVOKE ALL ON FUNCTION onkey_observed_transitions_refresh() FROM PUBLIC;

SELECT onkey_observed_transitions_refresh();

SELECT cron.unschedule('onkey-observed-transitions')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-observed-transitions');
SELECT cron.schedule('onkey-observed-transitions', '41 2 * * *',
                     'SELECT onkey_observed_transitions_refresh()');
