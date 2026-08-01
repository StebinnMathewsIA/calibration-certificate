-- Supabase-native OnKey platform foundation (#105, workstream A1).
-- Domain-event outbox (NEVER SOAP payloads: an adapter translates),
-- sync bookkeeping, and config with dry-run defaulted ON. All tables are
-- service-role only: the app never touches them directly, and the write
-- allowlist values live in this database, never the repo. Idempotent.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Domain events awaiting translation to OnKey by the Edge Function
-- adapter. dead_letter = the target moved underneath us (reconciliation
-- policy): visible to managers, never silently dropped.
CREATE TABLE IF NOT EXISTS onkey_outbox (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Our idempotency spine: rides ExternalReference on every import
    -- that supports it; retries query for it before re-sending.
    event_uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    schema_version int NOT NULL DEFAULT 1,
    kind varchar(64) NOT NULL,
    wo_code varchar(64),
    payload jsonb NOT NULL,
    state varchar(16) NOT NULL DEFAULT 'pending'
        CHECK (state IN ('pending', 'sent', 'failed', 'dead_letter')),
    attempts int NOT NULL DEFAULT 0,
    last_error text,
    record_failures jsonb,
    onkey_record_ids jsonb,
    created_by varchar(200),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS onkey_outbox_state_idx ON onkey_outbox (state, created_at);
ALTER TABLE onkey_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_outbox FROM anon, authenticated;

-- One row per sync/drain invocation: resumable backfills (chunk cursor)
-- and the admin observability card read from here.
CREATE TABLE IF NOT EXISTS onkey_sync_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    run_kind varchar(32) NOT NULL, -- 'export' | 'drain' | 'smoke' | 'introspect'
    report_code varchar(64),
    window_start timestamptz,
    window_end timestamptz,
    cursor jsonb,
    state varchar(16) NOT NULL DEFAULT 'running'
        CHECK (state IN ('running', 'succeeded', 'failed')),
    rows_fetched int NOT NULL DEFAULT 0,
    rows_inserted int NOT NULL DEFAULT 0,
    detail jsonb,
    error text,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz
);
CREATE INDEX IF NOT EXISTS onkey_sync_runs_started_idx ON onkey_sync_runs (started_at DESC);
ALTER TABLE onkey_sync_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_sync_runs FROM anon, authenticated;

-- Config: dry_run defaults ON (flips off only per explicit owner
-- instruction); write_allowlist holds the owner-designated test work
-- order codes (inserted directly in the database, never the repo).
CREATE TABLE IF NOT EXISTS onkey_config (
    key varchar(64) PRIMARY KEY,
    value jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE onkey_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_config FROM anon, authenticated;
INSERT INTO onkey_config (key, value) VALUES ('dry_run', 'true'::jsonb)
    ON CONFLICT (key) DO NOTHING;
INSERT INTO onkey_config (key, value) VALUES ('write_allowlist', '[]'::jsonb)
    ON CONFLICT (key) DO NOTHING;

-- Generic raw snapshot store for ANY Analyser Report (the WOE001
-- pattern generalized): append-only, content-hashed, never pruned (the
-- migration corpus for becoming the system of record).
CREATE TABLE IF NOT EXISTS onkey_report_rows (
    report_code varchar(64) NOT NULL,
    row_hash varchar(64) NOT NULL,
    data jsonb NOT NULL,
    source_ts timestamptz,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (report_code, row_hash)
);
CREATE INDEX IF NOT EXISTS onkey_report_rows_code_ts_idx
    ON onkey_report_rows (report_code, source_ts);
ALTER TABLE onkey_report_rows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON onkey_report_rows FROM anon, authenticated;
