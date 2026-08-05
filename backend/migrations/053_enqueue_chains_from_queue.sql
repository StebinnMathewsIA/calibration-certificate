-- 053_enqueue_chains_from_queue.sql
--
-- The enqueue planned each lifecycle event from our OnKey MIRROR, so two
-- events queued before the drain ran were both planned from the same
-- starting status. A real run exposed it: on_the_way, start, stop, all
-- within eight minutes, produced
--
--   seq 1  ALC -> WOR   (start)
--   seq 1  ALC -> WST   (stop)   <- should be WOR -> WST
--
-- The second hop should start where the first one ends. The drain sends
-- them in order, so by the time the stop is sent the work order is at WOR,
-- not ALC.
--
-- Why this matters more than it looks. The recorded fromStatus is not
-- decoration: it drives the register warning, and since migration 052 it
-- feeds onkey_transition_evidence, which learns from what OnKey accepts.
-- Left alone this would have recorded "ALC -> WST accepted" as fact, and
-- taught the register a transition that never happened, from its most
-- trusted source. A wrong fact in an evidence table is worse than a
-- missing one, because it is believed.
--
-- Offline makes it routine rather than rare: a technician with no signal
-- queues start, pause and stop, and all three replay together.
--
-- The fix chains from the last hop already queued for that work order,
-- falling back to the mirror when the queue is empty.

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
    start_status text;
BEGIN
    SELECT * INTO w FROM work_orders WHERE id = p_work_order_id;
    IF NOT FOUND OR w.external_ref IS NULL THEN RETURN 0; END IF;
    IF w.source IS DISTINCT FROM 'onkey' THEN RETURN 0; END IF;

    -- Where this work order will BE once everything already queued has
    -- been sent, not where the mirror currently says it is. Only
    -- unfinished rows count: a sent hop is already reflected in the
    -- mirror, and a blocked or dead-lettered one will never happen.
    SELECT o.payload ->> 'stateCode' INTO start_status
      FROM onkey_outbox o
     WHERE o.work_order_id = p_work_order_id
       AND o.state IN ('pending', 'failed')
     ORDER BY o.created_at DESC, o.seq DESC
     LIMIT 1;

    plan := onkey_transition_plan(
        coalesce(start_status, p_current_status), p_event, coalesce(p_reason, ''));

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
                -- Recorded when the planned start differs from the mirror,
                -- so a surprising fromStatus is explainable later.
                'chainedFrom', CASE WHEN start_status IS NOT NULL
                                    AND start_status IS DISTINCT FROM p_current_status
                                    THEN 'queue' ELSE 'mirror' END,
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
