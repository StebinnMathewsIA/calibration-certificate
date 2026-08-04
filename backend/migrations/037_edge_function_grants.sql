-- Let the OnKey Edge Function actually touch its own tables (#105).
--
-- Migration 026 created the OnKey platform tables and locked them down.
-- The lockdown was too broad: it stripped service_role's default grants
-- as well, leaving it with REFERENCES, TRIGGER and TRUNCATE and no
-- SELECT, INSERT or UPDATE on any of them. The Edge Function runs as
-- service_role, so the very first call it ever made failed with
-- "permission denied for table onkey_sync_runs".
--
-- Grants are per-table and per-privilege rather than ALL, and DELETE is
-- deliberately withheld everywhere: these tables are append-only by
-- design (snapshots are the migration corpus, the outbox is the audit
-- trail, sync runs are the record of what ran).
--
-- anon and authenticated stay locked out entirely. Nothing here widens
-- what a signed-in app user can reach; the app reads through the
-- app_* SECURITY DEFINER functions exactly as before.
-- Idempotent.

-- Sync runs: the function opens one per call and closes it after.
GRANT SELECT, INSERT, UPDATE ON public.onkey_sync_runs TO service_role;

-- Report snapshots: exports insert and refresh last_seen_at.
GRANT SELECT, INSERT, UPDATE ON public.onkey_report_rows TO service_role;

-- Config: read only. Dry-run and the write allowlist are changed by an
-- admin through the database, never by the function itself.
GRANT SELECT ON public.onkey_config TO service_role;

-- Outbox: the drain reads pending events and marks their outcome.
GRANT SELECT, INSERT, UPDATE ON public.onkey_outbox TO service_role;

-- Explicitly re-assert the lockdown, so this migration cannot be read
-- as loosening anything for app users.
REVOKE ALL ON public.onkey_sync_runs FROM anon, authenticated;
REVOKE ALL ON public.onkey_report_rows FROM anon, authenticated;
REVOKE ALL ON public.onkey_config FROM anon, authenticated;
REVOKE ALL ON public.onkey_outbox FROM anon, authenticated;
