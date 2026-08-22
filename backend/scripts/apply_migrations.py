#!/usr/bin/env python3
"""Applies backend/migrations/*.sql to the Supabase Postgres database and
ensures the private Storage bucket exists.

Usage (from backend/, with .env configured — see docs/supabase-setup.md):
    .venv/bin/python scripts/apply_migrations.py

APPLIED MIGRATIONS ARE TRACKED and never re-run (#150). This script used
to replay every file on every boot, trusting the files to be idempotent.
They were, individually, but replay-on-boot has a failure mode that
idempotence does not cover: a file that re-CREATEs a function or a cron
schedule REVERTS any newer definition applied since, and one erroring
file aborts the boot partway, leaving the database mid-era. That is not
theory: a boot replay silently reverted the technician roster, put the
sync cadence back to a retired schedule (every minute plus an hourly
twenty-minute sweep, which is the overlap #134 exists to prevent), and
failed every deploy for two days while Render quietly served the last
good instance.

The ledger is `schema_migrations`. A file is applied once, in its own
transaction, and recorded. A failure still aborts (fail-fast is right for
a NEW migration) but everything already recorded is never touched again.

Databases that predate the ledger are BASELINED on first run: every file
currently on disk is recorded as applied without being run, because the
live schema is already at or beyond it, and replaying history into a
newer present is exactly the bug this rewrite removes. Set
MIGRATIONS_BASELINE=off to disable baselining for a genuinely empty
database (first-ever setup), where every file should really run.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine  # noqa: E402

from app.config import MIGRATIONS_DIR, get_settings, validate_settings  # noqa: E402
from app.pdf_store import SupabaseStoragePdfStore  # noqa: E402

LEDGER = """
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now(),
    baselined boolean NOT NULL DEFAULT false
)
"""


def main() -> int:
    settings = get_settings()
    problems = validate_settings(settings)
    if problems:
        print("Configuration incomplete — see docs/supabase-setup.md:")
        for p in problems:
            print(f"  - {p}")
        return 1

    engine = create_engine(settings.database_url)

    raw = engine.raw_connection()
    try:
        cur = raw.cursor()
        cur.execute(LEDGER)
        cur.execute("SELECT count(*) FROM schema_migrations")
        ledger_rows = cur.fetchone()[0]
        raw.commit()

        files = sorted(MIGRATIONS_DIR.glob("*.sql"))

        if ledger_rows == 0 and os.environ.get("MIGRATIONS_BASELINE", "on") != "off":
            # First run against a database that already has history: record
            # everything on disk as applied without running it. The live
            # schema got here through these files (applied manually or by
            # the old replay), and running the past into the present is the
            # bug, not the feature.
            for path in files:
                cur.execute(
                    "INSERT INTO schema_migrations (filename, baselined) VALUES (%s, true) "
                    "ON CONFLICT (filename) DO NOTHING",
                    (path.name,),
                )
            raw.commit()
            print(f"baselined {len(files)} existing migrations; none re-run")
        else:
            # Pending is recomputed after EVERY file, not once up front: a
            # repair migration may un-record earlier files (124 does) so
            # that they re-run, in order, within the same boot.
            ran_this_boot: set[str] = set()
            applied_count = 0
            while True:
                cur.execute("SELECT filename FROM schema_migrations")
                applied = {row[0] for row in cur.fetchall()}
                pending = [p for p in files if p.name not in applied]
                if not pending:
                    break
                path = pending[0]
                if path.name in ran_this_boot:
                    raise RuntimeError(
                        f"{path.name} was un-recorded after running this boot; "
                        "a migration must never delete its own ledger row"
                    )
                sql = path.read_text()
                # Raw cursor, parameters=None: the SQL contains literal '%'
                # which psycopg2 would otherwise treat as a placeholder.
                cur.execute(sql)
                cur.execute(
                    "INSERT INTO schema_migrations (filename) VALUES (%s) "
                    "ON CONFLICT (filename) DO NOTHING",
                    (path.name,),
                )
                raw.commit()
                ran_this_boot.add(path.name)
                applied_count += 1
                print(f"applied {path.name}")
            if applied_count == 0:
                print(f"nothing to apply ({len(applied)} recorded)")
    finally:
        raw.close()

    store = SupabaseStoragePdfStore(
        settings.supabase_url,
        settings.supabase_service_role_key,
        settings.supabase_storage_bucket,
    )
    store.ensure_bucket()
    print(f"storage bucket '{settings.supabase_storage_bucket}' ready (private)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
