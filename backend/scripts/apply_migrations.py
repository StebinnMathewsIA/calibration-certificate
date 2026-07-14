#!/usr/bin/env python3
"""Applies backend/migrations/*.sql to the Supabase Postgres database and
ensures the private Storage bucket exists.

Usage (from backend/, with .env configured — see docs/supabase-setup.md):
    .venv/bin/python scripts/apply_migrations.py

Migrations are idempotent; re-running is safe.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import create_engine  # noqa: E402

from app.config import MIGRATIONS_DIR, get_settings, validate_settings  # noqa: E402
from app.pdf_store import SupabaseStoragePdfStore  # noqa: E402


def main() -> int:
    settings = get_settings()
    problems = validate_settings(settings)
    if problems:
        print("Configuration incomplete — see docs/supabase-setup.md:")
        for p in problems:
            print(f"  - {p}")
        return 1

    engine = create_engine(settings.database_url)
    for path in sorted(MIGRATIONS_DIR.glob("*.sql")):
        sql = path.read_text()
        # Raw DBAPI cursor with parameters=None: the SQL contains literal '%'
        # (trigger error message), which psycopg2 would otherwise treat as a
        # format placeholder.
        raw = engine.raw_connection()
        try:
            cur = raw.cursor()
            cur.execute(sql)
            raw.commit()
        finally:
            raw.close()
        print(f"applied {path.name}")

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
