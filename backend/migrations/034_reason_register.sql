-- OnKey's preconfigured reasons, and which of ours write back (#96).
--
-- FIELDOPS - REASON returns exactly two rows:
--   IFD  Incomplete for Spares   (sequence 1)
--   REF  Referral                (sequence 2)
--
-- Those are precisely the two pause reasons migration 027 marked
-- blocks_resume, chosen from a description of how technicians work
-- rather than from OnKey. OnKey records a reason only for the pauses
-- that hand the work order back; a break or a wait for the client is
-- not something it models.
--
-- So our six stay. Four of them are ours alone: real operational context
-- for the technician and the job card, with no OnKey counterpart and
-- nothing to write back. The two that DO map now carry the code to send.
--
-- Note the codes differ by surface: Incomplete for Spares is status LSI
-- on the work order and reason IFD in the progress log. Referral is REF
-- in both. That is why they are separate columns.
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_reasons (
    code text PRIMARY KEY,
    description text,
    classification text,
    sequence_number int,
    is_active boolean,
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE onkey_reasons ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION onkey_reasons_refresh() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
    touched int;
BEGIN
    WITH src AS (
        SELECT DISTINCT ON (r.data ->> 'Code')
            r.data ->> 'Code' AS code,
            r.data ->> 'Description' AS description,
            r.data ->> 'Classification' AS classification,
            nullif(r.data ->> 'SequenceNumber', '')::int AS sequence_number,
            (r.data ->> 'IsActive')::boolean AS is_active
        FROM onkey_report_rows r
        WHERE r.report_code = 'FIELDOPS - REASON'
          AND r.data ->> 'Code' IS NOT NULL
        ORDER BY r.data ->> 'Code', r.last_seen_at DESC
    ), up AS (
        INSERT INTO onkey_reasons AS t
            (code, description, classification, sequence_number, is_active)
        SELECT code, description, classification, sequence_number, is_active FROM src
        ON CONFLICT (code) DO UPDATE SET
            description = excluded.description,
            classification = excluded.classification,
            sequence_number = excluded.sequence_number,
            is_active = excluded.is_active,
            updated_at = now()
        RETURNING 1
    )
    SELECT count(*) INTO touched FROM up;
    RETURN jsonb_build_object('reasons', touched);
END $$;

REVOKE ALL ON FUNCTION onkey_reasons_refresh() FROM PUBLIC;

SELECT onkey_reasons_refresh();

-- Which of our reasons OnKey knows about. NULL means ours alone: the
-- pause is recorded on our side and nothing is sent.
ALTER TABLE work_order_pause_reasons
    ADD COLUMN IF NOT EXISTS onkey_reason_code text;

UPDATE work_order_pause_reasons SET onkey_reason_code = 'IFD'
    WHERE code = 'incomplete_spares';
UPDATE work_order_pause_reasons SET onkey_reason_code = 'REF'
    WHERE code = 'referral';

SELECT cron.unschedule('onkey-reasons-refresh')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'onkey-reasons-refresh');
SELECT cron.schedule('onkey-reasons-refresh', '35 2 * * *',
                     'SELECT onkey_reasons_refresh()');
