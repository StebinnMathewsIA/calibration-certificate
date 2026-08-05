-- 052_transition_evidence.sql
--
-- Learn the real transition rules from OnKey instead of from our own
-- incomplete register.
--
-- Our onkey_status_transitions came from an export and is demonstrably
-- partial: migration 036 recorded that only 15 of 25 OBSERVED transitions
-- appear in it, and DOCARC to CLC has fired 647 times while being absent.
-- Acting on it as though it were authoritative is what produced a wrong
-- confident answer about whether WOR could go back to ALC.
--
-- OnKey, however, tells us the truth when it refuses:
--
--   E202366: Invalid status change. Status changes for this work order
--            are restricted to Completed, Work Paused, Work Stopped,
--            To Be Cancelled.
--
-- One rejection yields the COMPLETE valid set for that source status. So
-- every rejection is register data, and this migration turns them into it.
--
-- Why this is capture rather than a probing campaign. Getting an
-- enumeration requires attempting an ACTIVE status that happens to be
-- invalid, and two other probe shapes were tested and rejected as useless:
--   a no-op (set a work order to the status it already holds) is ACCEPTED
--     and teaches nothing;
--   an INACTIVE status returns E5134 "An Inactive Status cannot be
--     selected", with no enumeration.
-- And an enumeration only exists for a status we currently hold a work
-- order in, of which there are two. Deliberately probing the Allocated one
-- would risk moving the only test bench that can still exercise start, for
-- a single status. Not worth it. Capturing every rejection that happens
-- anyway costs nothing and improves the register forever.

CREATE TABLE IF NOT EXISTS onkey_transition_evidence (
    from_code   varchar(32) NOT NULL,
    to_code     varchar(32) NOT NULL,
    allowed     boolean NOT NULL,
    source      varchar(24) NOT NULL,
    evidence    text,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now(),
    occurrences int NOT NULL DEFAULT 1,
    PRIMARY KEY (from_code, to_code, source)
);

ALTER TABLE onkey_transition_evidence ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE onkey_transition_evidence IS
    'What OnKey has actually told us about transitions. source: '
    '"rejection_enumerated" (named in an E202366 restricted-to list, the '
    'strongest evidence), "rejection_refused" (we tried it and were '
    'refused), "accepted" (we sent it and it worked).';

/** Map a status DESCRIPTION as OnKey words it back to its code. Prefers an
 * active status: "Closed" is both CLD (inactive) and CLC. */
CREATE OR REPLACE FUNCTION onkey_status_code_for(p_description text)
RETURNS text
LANGUAGE sql STABLE
AS $function$
    SELECT s.code FROM onkey_statuses s
     WHERE lower(trim(s.description)) = lower(trim(p_description))
     ORDER BY s.is_active DESC NULLS LAST, s.code
     LIMIT 1
$function$;

/** Fold one OnKey rejection into the evidence table. Returns what it
 * learned. Safe to call on any failure message: anything that is not an
 * E202366 enumeration records only the refusal itself. */
CREATE OR REPLACE FUNCTION onkey_learn_from_rejection(
    p_from text,
    p_to text,
    p_message text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    list_text text;
    desc_item text;
    code text;
    learned text[] := '{}';
BEGIN
    IF coalesce(p_from, '') = '' OR coalesce(p_to, '') = '' THEN
        RETURN jsonb_build_object('learned', '[]'::jsonb, 'note', 'no from/to');
    END IF;

    -- The attempt itself is evidence, whatever the message said.
    INSERT INTO onkey_transition_evidence (from_code, to_code, allowed, source, evidence)
    VALUES (p_from, p_to, false, 'rejection_refused', left(p_message, 500))
    ON CONFLICT (from_code, to_code, source) DO UPDATE
       SET last_seen_at = now(),
           occurrences = onkey_transition_evidence.occurrences + 1,
           evidence = EXCLUDED.evidence;

    -- "... are restricted to A, B, C." The full valid set for p_from.
    list_text := substring(p_message from 'restricted to ([^.]*)');
    IF list_text IS NULL THEN
        RETURN jsonb_build_object('learned', to_jsonb(learned),
                                  'note', 'no restricted-to list in message');
    END IF;

    FOREACH desc_item IN ARRAY string_to_array(list_text, ',') LOOP
        code := onkey_status_code_for(trim(desc_item));
        IF code IS NULL THEN CONTINUE; END IF;
        learned := learned || code;
        INSERT INTO onkey_transition_evidence (from_code, to_code, allowed, source, evidence)
        VALUES (p_from, code, true, 'rejection_enumerated', left(p_message, 500))
        ON CONFLICT (from_code, to_code, source) DO UPDATE
           SET last_seen_at = now(),
               occurrences = onkey_transition_evidence.occurrences + 1,
               evidence = EXCLUDED.evidence;
    END LOOP;

    RETURN jsonb_build_object('from', p_from, 'refused', p_to,
                              'learned', to_jsonb(learned));
END $function$;

/** A transition we sent that OnKey accepted. */
CREATE OR REPLACE FUNCTION onkey_learn_from_success(p_from text, p_to text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    INSERT INTO onkey_transition_evidence (from_code, to_code, allowed, source, evidence)
    SELECT p_from, p_to, true, 'accepted', 'sent and accepted'
     WHERE coalesce(p_from, '') <> '' AND coalesce(p_to, '') <> ''
    ON CONFLICT (from_code, to_code, source) DO UPDATE
       SET last_seen_at = now(),
           occurrences = onkey_transition_evidence.occurrences + 1
$function$;

GRANT EXECUTE ON FUNCTION onkey_learn_from_rejection(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION onkey_learn_from_success(text, text) TO service_role;

/** Everything we know about a transition, and where the knowledge came
 * from. Evidence outranks the register, because the register is the thing
 * we already proved wrong. */
CREATE OR REPLACE VIEW onkey_transitions_known AS
    WITH all_pairs AS (
        SELECT from_code, to_code FROM onkey_status_transitions WHERE coalesce(is_active, false)
        UNION
        SELECT from_code, to_code FROM onkey_status_transitions_observed
        UNION
        SELECT from_code, to_code FROM onkey_transition_evidence
    )
    SELECT
        p.from_code,
        p.to_code,
        EXISTS (SELECT 1 FROM onkey_status_transitions t
                 WHERE t.from_code = p.from_code AND t.to_code = p.to_code
                   AND coalesce(t.is_active, false)) AS in_register,
        coalesce((SELECT o.occurrences FROM onkey_status_transitions_observed o
                   WHERE o.from_code = p.from_code AND o.to_code = p.to_code), 0) AS observed,
        (SELECT bool_or(e.allowed) FROM onkey_transition_evidence e
          WHERE e.from_code = p.from_code AND e.to_code = p.to_code) AS onkey_says_allowed,
        (SELECT string_agg(DISTINCT e.source, ', ' ORDER BY e.source)
           FROM onkey_transition_evidence e
          WHERE e.from_code = p.from_code AND e.to_code = p.to_code) AS evidence_sources
    FROM all_pairs p;

COMMENT ON VIEW onkey_transitions_known IS
    'Register, observed history and OnKey evidence side by side. A row '
    'with onkey_says_allowed set is authoritative; in_register alone is '
    'not, and observed alone means it happened however the register feels.';
