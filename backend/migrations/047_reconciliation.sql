-- 047_reconciliation.sql
--
-- Verification of a write belongs HERE, not in the drain. The drain has
-- only our mirror to look at, refreshed by the export every couple of
-- minutes, so a read-back straight after sending would see the old status
-- and call a good write a failure. The sync is where the data is fresh, so
-- this is where "did OnKey actually take it" gets answered.
--
-- It also answers the harder question the drain cannot: our lifecycle and
-- OnKey's status are two state machines with two authors. The planner
-- writes too, and often: Allocated to To be Planned fired 49 times in a
-- few days. So divergence is normal traffic, not an error, and it has to
-- be surfaced rather than silently resolved in either direction.

CREATE TABLE IF NOT EXISTS wo_divergence (
    work_order_id   uuid PRIMARY KEY REFERENCES work_orders(id) ON DELETE CASCADE,
    wo_code         varchar(64),
    kind            varchar(32) NOT NULL,
    our_state       varchar(32),
    onkey_status    varchar(32),
    expected_status varchar(32),
    detail          text,
    detected_at     timestamptz NOT NULL DEFAULT now(),
    acknowledged_at timestamptz,
    acknowledged_by varchar(255)
);

COMMENT ON TABLE wo_divergence IS
    'Where our lifecycle and OnKey disagree. One row per work order, '
    'refreshed each sync; cleared when they agree again.';

CREATE INDEX IF NOT EXISTS wo_divergence_open ON wo_divergence (detected_at)
    WHERE acknowledged_at IS NULL;

/** Recompute divergence from the freshly synced register. Idempotent, and
 * safe to run on every sync. */
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
    WITH candidate AS (
        SELECT
            w.id, w.external_ref, l.state AS our_state, w.status_code,
            -- What we last asked OnKey to move it to, if anything.
            (SELECT o.payload ->> 'stateCode'
               FROM onkey_outbox o
              WHERE o.work_order_id = w.id AND o.state = 'sent'
              ORDER BY o.sent_at DESC NULLS LAST, o.seq DESC
              LIMIT 1) AS expected,
            (SELECT count(*) FROM onkey_outbox o
              WHERE o.work_order_id = w.id AND o.state = 'dead_letter') AS dead
        FROM work_orders w
        JOIN work_order_lifecycle l ON l.work_order_id = w.id
        WHERE w.source = 'onkey' AND w.external_ref IS NOT NULL
    ), judged AS (
        SELECT c.*,
            CASE
                -- A write we believe landed, that OnKey does not show.
                WHEN c.expected IS NOT NULL AND c.status_code IS DISTINCT FROM c.expected
                    THEN 'write_not_reflected'
                -- The office pulled the job back while the technician has
                -- it in hand. This is the one that gets somebody driving
                -- to a forecourt for work that is no longer theirs.
                WHEN c.our_state IN ('on_the_way', 'started', 'paused')
                     AND c.status_code IN ('TBP', 'TUA', 'CAN', 'TBC')
                    THEN 'recalled_while_in_hand'
                -- Closed by the office while we still think it is live.
                WHEN c.our_state IN ('on_the_way', 'started', 'paused')
                     AND EXISTS (SELECT 1 FROM onkey_statuses s
                                  WHERE s.code = c.status_code
                                    AND s.base_status_description IN ('Completed', 'Closed'))
                    THEN 'closed_while_in_hand'
                WHEN c.dead > 0 THEN 'write_dead_lettered'
                ELSE NULL
            END AS kind
        FROM candidate c
    ), upserted AS (
        INSERT INTO wo_divergence (
            work_order_id, wo_code, kind, our_state, onkey_status,
            expected_status, detail, detected_at)
        SELECT id, external_ref, kind, our_state, status_code, expected,
               format('our lifecycle is %s, OnKey says %s%s',
                      our_state, coalesce(status_code, 'nothing'),
                      CASE WHEN expected IS NOT NULL
                           THEN format(', we last sent %s', expected) ELSE '' END),
               now()
        FROM judged WHERE kind IS NOT NULL
        ON CONFLICT (work_order_id) DO UPDATE SET
            kind = EXCLUDED.kind,
            our_state = EXCLUDED.our_state,
            onkey_status = EXCLUDED.onkey_status,
            expected_status = EXCLUDED.expected_status,
            detail = EXCLUDED.detail,
            -- detected_at is NOT bumped: how long it has been diverging is
            -- the useful number, and re-detecting the same thing every two
            -- minutes would reset it to zero forever.
            acknowledged_at = CASE WHEN wo_divergence.kind IS DISTINCT FROM EXCLUDED.kind
                                   THEN NULL ELSE wo_divergence.acknowledged_at END
        RETURNING 1
    )
    SELECT count(*) INTO found FROM upserted;

    -- Agreement restored: drop the row rather than leave a stale warning.
    WITH gone AS (
        DELETE FROM wo_divergence d
         WHERE NOT EXISTS (
            SELECT 1 FROM work_orders w
              JOIN work_order_lifecycle l ON l.work_order_id = w.id
             WHERE w.id = d.work_order_id
               AND (
                    (l.state IN ('on_the_way','started','paused')
                     AND (w.status_code IN ('TBP','TUA','CAN','TBC')
                          OR EXISTS (SELECT 1 FROM onkey_statuses s
                                      WHERE s.code = w.status_code
                                        AND s.base_status_description IN ('Completed','Closed'))))
                 OR EXISTS (SELECT 1 FROM onkey_outbox o
                             WHERE o.work_order_id = w.id AND o.state = 'dead_letter')
                 OR EXISTS (SELECT 1 FROM onkey_outbox o
                             WHERE o.work_order_id = w.id AND o.state = 'sent'
                               AND w.status_code IS DISTINCT FROM o.payload ->> 'stateCode')
               ))
        RETURNING 1
    )
    SELECT count(*) INTO cleared FROM gone;

    RETURN jsonb_build_object('diverged', found, 'cleared', cleared);
END $function$;

/** Divergence on the technician's own work, for the app to show. */
CREATE OR REPLACE FUNCTION app_wo_divergence()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT coalesce(jsonb_agg(jsonb_build_object(
               'workOrderId', d.work_order_id,
               'reference', d.wo_code,
               'kind', d.kind,
               'ourState', d.our_state,
               'onkeyStatus', coalesce(s.description, d.onkey_status),
               'detail', d.detail,
               'detectedAt', to_char(d.detected_at AT TIME ZONE 'UTC',
                                     'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'))
               ORDER BY d.detected_at), '[]'::jsonb)
    FROM wo_divergence d
    JOIN work_orders w ON w.id = d.work_order_id
    LEFT JOIN onkey_statuses s ON s.code = d.onkey_status
    WHERE d.acknowledged_at IS NULL
      AND app_staff_code() IS NOT NULL
      AND w.staff_code = app_staff_code()
$function$;

CREATE OR REPLACE FUNCTION app_wo_ack_divergence(p_work_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
    UPDATE wo_divergence SET acknowledged_at = now(), acknowledged_by = app_email()
     WHERE work_order_id = p_work_order_id
       AND EXISTS (SELECT 1 FROM work_orders w
                    WHERE w.id = p_work_order_id AND w.staff_code = app_staff_code());
    RETURN app_wo_divergence();
END $function$;

GRANT EXECUTE ON FUNCTION app_wo_divergence() TO authenticated;
GRANT EXECUTE ON FUNCTION app_wo_ack_divergence(uuid) TO authenticated;

-- Runs right behind the seeding job, on the same minute cadence, so a
-- recall is visible to the technician within a couple of minutes.
DO $$
BEGIN
    PERFORM cron.unschedule('wo-reconcile')
     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wo-reconcile');
    PERFORM cron.schedule('wo-reconcile', '* * * * *', $cron$SELECT wo_reconcile()$cron$);
END $$;
