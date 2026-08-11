-- Incremental Syspro loads, and a schedule (#142).
--
-- MEASURED, 2026-08-11, which is what makes the cadence defensible:
--
--   connection floor (any trivial query)      ~1.9 s
--   full scan, first 5,000 rows                4.1 s
--   full load, everything                     36   s
--   incremental at the high-water mark         1.9 s   (nothing changed)
--
-- InvWarehouse.TimeStamp is a SQL Server rowversion: binary, monotonic,
-- and bumped on every update. It is NOT indexed, so the predicate scans,
-- but the scan is cheap enough that an idle incremental pull costs
-- essentially nothing beyond connecting. That is what makes a short
-- interval honest rather than wishful.
--
-- WHAT A ROWVERSION CANNOT SEE: a deleted row. Its rowversion goes with
-- it, so no incremental pull will ever notice. That is why the full load
-- stays on a nightly schedule and keeps its prune. Incremental for
-- freshness, full for truth.
--
-- Idempotent.

CREATE TABLE IF NOT EXISTS syspro_watermark (
    company varchar(64) PRIMARY KEY,
    /** Hex of the rowversion, e.g. '0x000000071D8E776A'. Stored as text
     * because it is opaque: we only ever compare it by handing it back to
     * SQL Server, never by interpreting it here. */
    high_water text,
    updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE syspro_watermark ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON syspro_watermark FROM anon, authenticated;

ALTER TABLE syspro_loads ADD COLUMN IF NOT EXISTS mode varchar(16) NOT NULL DEFAULT 'full';
ALTER TABLE syspro_loads ADD COLUMN IF NOT EXISTS high_water text;

/** Freshness for the ops alert and the stock tab. Counts an incremental
 * load, because for freshness purposes it is as good as a full one. */
CREATE OR REPLACE FUNCTION syspro_last_load()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT max(finished_at) FROM syspro_loads WHERE state = 'succeeded';
$function$;

/** Minutes since the last successful load of any kind. NULL if none has
 * ever run, which is a different thing from stale and is said so. */
CREATE OR REPLACE FUNCTION syspro_minutes_stale()
RETURNS int
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT CASE
        WHEN syspro_last_load() IS NULL THEN NULL
        ELSE (extract(epoch FROM (now() - syspro_last_load())) / 60)::int
    END;
$function$;
