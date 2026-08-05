-- 049_review_fixes.sql
--
-- Fixes for defects found reviewing migrations 045 to 048.

-- ---------------------------------------------------------------------
-- 1 and 2: head-of-line ordering, and starvation.
--
-- The drain picked candidates in TypeScript: fetch rows eligible to send,
-- then keep the first per work order. Two bugs came out of that.
--
-- Ordering: when hop 1 failed it got a not_before backoff, which made it
-- INELIGIBLE, which removed it from the candidate list, which promoted
-- hop 2 to the head of that work order. Reproduced live: with WPA backing
-- off and LSI pending, the candidate query returned LSI alone. A pause for
-- spares would have written Incomplete for Spares to OnKey with no Work
-- Paused before it, the exact out-of-order write the rule exists to stop.
--
-- Starvation: LIMIT was applied BEFORE the per-work-order reduction, so a
-- single work order with 25 queued rows filled the page and no other work
-- order was ever fetched.
--
-- Both go away by choosing the head in SQL. DISTINCT ON picks the true
-- head per work order from ALL unfinished rows, backoff included, and only
-- then is eligibility applied: a head in backoff yields nothing for that
-- work order rather than letting its successor past. LIMIT lands after the
-- reduction, so one busy job cannot crowd out the rest.
CREATE OR REPLACE FUNCTION onkey_outbox_next(p_limit int DEFAULT 25)
RETURNS SETOF onkey_outbox
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    WITH head AS (
        -- coalesce, not wo_code alone: rows with no code are independent
        -- of each other and must not collapse into a single partition.
        SELECT DISTINCT ON (coalesce(wo_code, id::text)) *
          FROM onkey_outbox
         WHERE state IN ('pending', 'failed')
         ORDER BY coalesce(wo_code, id::text), created_at, seq
    )
    SELECT * FROM head
     WHERE not_before IS NULL OR not_before <= now()
     ORDER BY created_at, seq
     LIMIT p_limit
$function$;

COMMENT ON FUNCTION onkey_outbox_next(int) IS
    'The drainable head of each work order queue. A head in retry backoff '
    'yields nothing for that work order, so successors cannot overtake it.';

-- ---------------------------------------------------------------------
-- 6a: the enqueue counter reported hops it had not queued, because
-- ON CONFLICT DO NOTHING can insert nothing and the counter incremented
-- regardless. A replayed RPC therefore claimed work it did not do.
CREATE OR REPLACE FUNCTION app_wo_enqueue_onkey(
    p_work_order_id uuid,
    p_event_id uuid,
    p_event text,
    p_reason text,
    p_current_status text)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    w work_orders%ROWTYPE;
    plan jsonb;
    hop jsonb;
    i smallint := 0;
    inserted int;
    queued int := 0;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND OR w.external_ref IS NULL THEN RETURN 0; END IF;
    IF w.source IS DISTINCT FROM 'onkey' THEN RETURN 0; END IF;

    plan := onkey_transition_plan(p_current_status, p_event, coalesce(p_reason, ''));

    FOR hop IN SELECT * FROM jsonb_array_elements(plan -> 'hops') LOOP
        i := i + 1;
        INSERT INTO onkey_outbox (
            kind, wo_code, work_order_id, source_event_id, seq, payload,
            state, register_warning, created_by)
        VALUES (
            'status_change', w.external_ref, p_work_order_id, p_event_id, i,
            jsonb_build_object(
                'stateCode', hop ->> 'to',
                'fromStatus', hop ->> 'from',
                'ourEvent', p_event,
                'ourReason', coalesce(p_reason, ''),
                'remark', 'PWC ' || p_event || ' ' || p_event_id::text),
            'pending',
            CASE WHEN (hop ->> 'allowed')::boolean THEN NULL
                 ELSE format('our register does not list %s to %s; sending anyway, OnKey decides',
                             hop ->> 'from', hop ->> 'to') END,
            app_email())
        ON CONFLICT (source_event_id, seq) WHERE source_event_id IS NOT NULL DO NOTHING;
        GET DIAGNOSTICS inserted = ROW_COUNT;
        queued := queued + inserted;
    END LOOP;

    RETURN queued;
END $function$;

REVOKE ALL ON FUNCTION app_wo_enqueue_onkey(uuid, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app_wo_enqueue_onkey(uuid, uuid, text, text, text) FROM anon, authenticated;

-- ---------------------------------------------------------------------
-- 4: every sibling table has row level security on. This one did not.
-- There is no SELECT grant to authenticated today, so nothing leaked, but
-- the point of the second layer is to survive somebody adding a grant
-- through the dashboard later, which is a normal thing to do.
ALTER TABLE wo_divergence ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 3 and 5: one definition of divergence, and a grace period.
--
-- 5: wo_reconcile expressed the conditions twice, once to judge and again,
-- differently shaped, to clear. Two copies drift, and the drift shows up
-- as a warning that never goes away. Both now read this one view.
--
-- 3: write_not_reflected had no grace period. The export takes a couple of
-- minutes to show a change and reconciliation runs every minute, so every
-- successful write would have told the technician "the office has not
-- received your update" until the sync caught up. An alarm that fires on
-- normal operation is an alarm nobody reads.
CREATE OR REPLACE VIEW wo_divergence_current AS
    WITH candidate AS (
        SELECT
            w.id, w.external_ref, w.status_code, l.state AS our_state,
            (SELECT o.payload ->> 'stateCode'
               FROM onkey_outbox o
              WHERE o.work_order_id = w.id
                AND o.state = 'sent'
                -- Grace: only a write old enough to have come back round
                -- through the export counts as unreflected.
                AND o.sent_at < now() - interval '6 minutes'
              ORDER BY o.sent_at DESC NULLS LAST, o.seq DESC
              LIMIT 1) AS expected,
            EXISTS (SELECT 1 FROM onkey_outbox o
                     WHERE o.work_order_id = w.id AND o.state = 'dead_letter') AS dead
        FROM work_orders w
        JOIN work_order_lifecycle l ON l.work_order_id = w.id
        WHERE w.source = 'onkey' AND w.external_ref IS NOT NULL
    )
    SELECT
        c.id AS work_order_id,
        c.external_ref AS wo_code,
        c.our_state,
        c.status_code AS onkey_status,
        c.expected AS expected_status,
        CASE
            WHEN c.expected IS NOT NULL AND c.status_code IS DISTINCT FROM c.expected
                THEN 'write_not_reflected'
            WHEN c.our_state IN ('on_the_way', 'started', 'paused')
                 AND c.status_code IN ('TBP', 'TUA', 'CAN', 'TBC')
                THEN 'recalled_while_in_hand'
            WHEN c.our_state IN ('on_the_way', 'started', 'paused')
                 AND EXISTS (SELECT 1 FROM onkey_statuses s
                              WHERE s.code = c.status_code
                                AND s.base_status_description IN ('Completed', 'Closed'))
                THEN 'closed_while_in_hand'
            WHEN c.dead THEN 'write_dead_lettered'
            ELSE NULL
        END AS kind
    FROM candidate c;

CREATE OR REPLACE FUNCTION wo_reconcile()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    found int;
    cleared int;
BEGIN
    WITH upserted AS (
        INSERT INTO wo_divergence (
            work_order_id, wo_code, kind, our_state, onkey_status,
            expected_status, detail, detected_at)
        SELECT work_order_id, wo_code, kind, our_state, onkey_status, expected_status,
               format('our lifecycle is %s, OnKey says %s%s',
                      our_state, coalesce(onkey_status, 'nothing'),
                      CASE WHEN expected_status IS NOT NULL
                           THEN format(', we last sent %s', expected_status) ELSE '' END),
               now()
        FROM wo_divergence_current WHERE kind IS NOT NULL
        ON CONFLICT (work_order_id) DO UPDATE SET
            kind = EXCLUDED.kind,
            our_state = EXCLUDED.our_state,
            onkey_status = EXCLUDED.onkey_status,
            expected_status = EXCLUDED.expected_status,
            detail = EXCLUDED.detail,
            -- detected_at is NOT bumped: how long it has been diverging is
            -- the useful number, and re-detecting the same thing every
            -- minute would hold it at zero forever.
            acknowledged_at = CASE WHEN wo_divergence.kind IS DISTINCT FROM EXCLUDED.kind
                                   THEN NULL ELSE wo_divergence.acknowledged_at END
        RETURNING 1
    )
    SELECT count(*) INTO found FROM upserted;

    WITH gone AS (
        DELETE FROM wo_divergence d
         WHERE NOT EXISTS (
            SELECT 1 FROM wo_divergence_current c
             WHERE c.work_order_id = d.work_order_id AND c.kind IS NOT NULL)
        RETURNING 1
    )
    SELECT count(*) INTO cleared FROM gone;

    RETURN jsonb_build_object('diverged', found, 'cleared', cleared);
END $function$;
