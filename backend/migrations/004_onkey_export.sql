-- OnKey WOE001 export sync (#47): raw snapshot store.
-- Idempotent: safe to re-run. Applied by scripts/apply_migrations.py.
--
-- Every export row lands intact as jsonb (schema-agnostic: WOE001's column
-- set is preserved verbatim), keyed by a content hash so re-pulling the same
-- window is a no-op and changed rows append as new versions — the table is a
-- snapshot log, which is the audit-friendly shape for "what did OnKey say".

CREATE TABLE IF NOT EXISTS onkey_woe001 (
    row_hash      char(64)    PRIMARY KEY,   -- sha256 of the sorted row JSON
    data          jsonb       NOT NULL,
    start_date_ts timestamptz,               -- parsed from the StartDate column
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS onkey_woe001_start_idx ON onkey_woe001 (start_date_ts);

-- Supabase exposure lockdown (same rationale as 001-003).
ALTER TABLE onkey_woe001 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_woe001 FROM anon, authenticated;
