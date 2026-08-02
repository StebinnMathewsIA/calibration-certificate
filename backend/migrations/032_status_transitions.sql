-- The OnKey transition map, and our lifecycle mapped onto it (#96).
--
-- FIELDOPS - STATEMAP gives 115 allowed transitions with
-- ApplyTargetStatusRules true throughout, so OnKey enforces them. The
-- technician path it describes is our state machine exactly:
--
--   ALC -> WOR -> WPA <-> WRE -> WST -> WOS -> CPD
--                  |
--                  +-> LSI (Incomplete for Spares) / REF (Referral)
--
-- LSI and REF are reachable ONLY from WPA and neither leads back to
-- WRE, which is the blocks_resume rule from migration 027 enforced by
-- OnKey rather than by us. That is why pausing for spares or referral
-- sends TWO hops: WPA then LSI/REF.
--
-- Nothing here writes to OnKey. This is the validation layer that has to
-- exist before the write path is switched on, so an illegal transition
-- is refused by us before it ever reaches a live work order.
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_status_transitions (
    from_code text NOT NULL,
    to_code text NOT NULL,
    is_active boolean,
    rules_enforced boolean,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (from_code, to_code)
);

ALTER TABLE onkey_status_transitions ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION onkey_status_transitions_refresh() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    touched int;
BEGIN
    WITH src AS (
        SELECT DISTINCT ON (r.data ->> 'ParentCode', r.data ->> 'WorkOrderStatusCode')
            r.data ->> 'ParentCode' AS from_code,
            r.data ->> 'WorkOrderStatusCode' AS to_code,
            (r.data ->> 'IsActive')::boolean AS is_active,
            (r.data ->> 'ParentApplyTargetStatusRules')::boolean AS rules_enforced
        FROM onkey_report_rows r
        WHERE r.report_code = 'FIELDOPS - STATEMAP'
          AND r.data ->> 'ParentCode' IS NOT NULL
          AND r.data ->> 'WorkOrderStatusCode' IS NOT NULL
        ORDER BY r.data ->> 'ParentCode', r.data ->> 'WorkOrderStatusCode',
                 r.last_seen_at DESC
    ), up AS (
        INSERT INTO onkey_status_transitions AS t
            (from_code, to_code, is_active, rules_enforced)
        SELECT from_code, to_code, is_active, rules_enforced FROM src
        ON CONFLICT (from_code, to_code) DO UPDATE SET
            is_active = excluded.is_active,
            rules_enforced = excluded.rules_enforced,
            updated_at = now()
        RETURNING 1
    )
    SELECT count(*) INTO touched FROM up;
    RETURN jsonb_build_object('transitions', touched);
END $$;

REVOKE ALL ON FUNCTION onkey_status_transitions_refresh() FROM PUBLIC;

SELECT onkey_status_transitions_refresh();

-- Our lifecycle event -> the OnKey hops it means. Ordered, because a
-- blocking pause is WPA followed by the reason status.
CREATE TABLE IF NOT EXISTS wo_status_map (
    event text NOT NULL,
    reason text NOT NULL DEFAULT '',
    onkey_codes text[] NOT NULL,
    note text,
    PRIMARY KEY (event, reason)
);

ALTER TABLE wo_status_map ENABLE ROW LEVEL SECURITY;

INSERT INTO wo_status_map (event, reason, onkey_codes, note) VALUES
    ('start',    '',                  ARRAY['WOR'], 'First start: Work Order Received'),
    ('resume',   '',                  ARRAY['WRE'], 'Resume from paused: Work Resumed'),
    ('pause',    '',                  ARRAY['WPA'], 'Work Paused'),
    ('pause',    'break',             ARRAY['WPA'], 'Work Paused'),
    ('pause',    'awaiting_client',   ARRAY['WPA'], 'Work Paused'),
    ('pause',    'site_unsafe',       ARRAY['WPA'], 'Work Paused'),
    ('pause',    'other',             ARRAY['WPA'], 'Work Paused'),
    ('pause',    'incomplete_spares', ARRAY['WPA','LSI'], 'Pause then Incomplete for Spares; cannot be resumed'),
    ('pause',    'referral',          ARRAY['WPA','REF'], 'Pause then Referral; cannot be resumed'),
    ('stop',     '',                  ARRAY['WST'], 'Work Stopped'),
    ('sign_off', '',                  ARRAY['WOS'], 'Work Order Signed')
ON CONFLICT (event, reason) DO UPDATE SET
    onkey_codes = excluded.onkey_codes,
    note = excluded.note;

-- Is this hop legal? Unknown statuses answer false: we refuse what we
-- cannot verify rather than hoping OnKey accepts it.
CREATE OR REPLACE FUNCTION onkey_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT EXISTS (
        SELECT 1 FROM onkey_status_transitions
        WHERE from_code = p_from AND to_code = p_to
          AND coalesce(is_active, false)
    )
$$;

-- Walk the whole chain for an event from a work order's current status,
-- returning each hop and whether it is legal. The write path calls this
-- and refuses to queue anything that is not fully allowed.
CREATE OR REPLACE FUNCTION onkey_transition_plan(
    p_current text, p_event text, p_reason text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    codes text[];
    hops jsonb := '[]'::jsonb;
    cursor_status text := p_current;
    code text;
    ok boolean;
    all_ok boolean := true;
BEGIN
    SELECT onkey_codes INTO codes FROM wo_status_map
    WHERE event = p_event AND reason = coalesce(p_reason, '');
    IF codes IS NULL THEN
        SELECT onkey_codes INTO codes FROM wo_status_map
        WHERE event = p_event AND reason = '';
    END IF;
    IF codes IS NULL THEN
        RETURN jsonb_build_object(
            'allowed', false, 'reason', 'no status mapping for this event', 'hops', hops);
    END IF;

    FOREACH code IN ARRAY codes LOOP
        ok := onkey_transition_allowed(cursor_status, code);
        all_ok := all_ok AND ok;
        hops := hops || jsonb_build_object('from', cursor_status, 'to', code, 'allowed', ok);
        cursor_status := code;
    END LOOP;

    RETURN jsonb_build_object('allowed', all_ok, 'hops', hops, 'finalStatus', cursor_status);
END $$;

REVOKE ALL ON FUNCTION onkey_transition_allowed(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION onkey_transition_plan(text, text, text) FROM PUBLIC;

SELECT cron.unschedule('onkey-transitions-refresh')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-transitions-refresh');
SELECT cron.schedule('onkey-transitions-refresh', '23 2 * * *',
                     'SELECT onkey_status_transitions_refresh()');
