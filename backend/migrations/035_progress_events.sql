-- OnKey's progress EventType, decoded from real data (#96).
--
-- FIELDOPS - PROGRESS over 2 months returned 1000 events. EventType is a
-- small integer with no lookup table, so it was decoded by correlating
-- it with the status each event landed on:
--
--   0 -> WOR  Work Order Received   378 events   start
--   1 -> WST  Work Stopped          275 events   stop
--   2 -> WPA  Work Paused            68 events   pause (carries a reason)
--   3 -> WRE  Work Resumed           11 events   resume
--   5 -> CPD  Completed             268 events   completed, office side
--   4 -> not observed in the window
--
-- Real sequences read exactly like our state machine, for example
-- FMC0074689: 0 WOR, 2 WPA, 3 WRE, 2 WPA, 3 WRE, 1 WST, 5 CPD.
--
-- Two details that matter for the write path. A reason is attached ONLY
-- to pause events (61 of 68 preconfigured, 7 free text, and IFD
-- outnumbers REF roughly eight to one); no other event type carries one,
-- which is the rule our UI already enforces. And 92 percent of events
-- carry a GPS fix, so recording location on a transition is normal here
-- rather than something we invented.
--
-- Sign-off has no event type: WST is followed by CPD in the log with no
-- event in between, so the WOS status change appears not to raise a
-- progress event. Left NULL rather than guessed.
-- Idempotent.

CREATE TABLE IF NOT EXISTS onkey_event_types (
    event_type int PRIMARY KEY,
    our_event text,
    status_code text,
    description text,
    carries_reason boolean NOT NULL DEFAULT false
);

ALTER TABLE onkey_event_types ENABLE ROW LEVEL SECURITY;

INSERT INTO onkey_event_types
    (event_type, our_event, status_code, description, carries_reason) VALUES
    (0, 'start',  'WOR', 'Work Order Received', false),
    (1, 'stop',   'WST', 'Work Stopped',        false),
    (2, 'pause',  'WPA', 'Work Paused',         true),
    (3, 'resume', 'WRE', 'Work Resumed',        false),
    (5, NULL,     'CPD', 'Completed (office)',  false)
ON CONFLICT (event_type) DO UPDATE SET
    our_event = excluded.our_event,
    status_code = excluded.status_code,
    description = excluded.description,
    carries_reason = excluded.carries_reason;

-- The status map gains the event type to post alongside the status
-- change, so a lifecycle transition writes both surfaces consistently.
ALTER TABLE wo_status_map
    ADD COLUMN IF NOT EXISTS onkey_event_type int;

UPDATE wo_status_map SET onkey_event_type = 0 WHERE event = 'start';
UPDATE wo_status_map SET onkey_event_type = 3 WHERE event = 'resume';
UPDATE wo_status_map SET onkey_event_type = 2 WHERE event = 'pause';
UPDATE wo_status_map SET onkey_event_type = 1 WHERE event = 'stop';
-- sign_off deliberately left NULL: see the header note.
