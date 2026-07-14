#!/usr/bin/env python3
"""CI helper: constructs DATABASE_URL from SUPABASE_URL + SUPABASE_DB_PASSWORD
by probing Supabase session-pooler hosts until one authenticates.

Used when the DATABASE_URL secret is not set — the password alone is easier
to configure correctly (no URL-encoding pitfalls, no region lookup). Writes
DATABASE_URL to $GITHUB_ENV for subsequent steps; prints only the host,
never the credential.
"""
import os
import re
import sys
from urllib.parse import quote

from sqlalchemy import create_engine, text

REGIONS = [
    "eu-central-1", "eu-west-1", "eu-west-2", "eu-west-3", "eu-north-1",
    "af-south-1", "us-east-1", "us-east-2", "us-west-1", "us-west-2",
    "ca-central-1", "sa-east-1", "ap-southeast-1", "ap-southeast-2",
    "ap-northeast-1", "ap-northeast-2", "ap-south-1",
]


def main() -> int:
    if os.environ.get("DATABASE_URL"):
        print("DATABASE_URL already set — nothing to resolve")
        return 0

    supabase_url = os.environ.get("SUPABASE_URL", "")
    password = os.environ.get("SUPABASE_DB_PASSWORD", "")
    ref_match = re.match(r"https://([a-z0-9]+)\.supabase\.co/?$", supabase_url.strip())
    if not ref_match or not password:
        print(
            "::error::Set either the DATABASE_URL secret, or SUPABASE_URL + "
            "SUPABASE_DB_PASSWORD secrets"
        )
        return 1
    ref = ref_match.group(1)
    pw = quote(password, safe="")

    hosts = [f"aws-{n}-{r}.pooler.supabase.com" for n in (0, 1) for r in REGIONS]
    for host in hosts:
        url = (
            f"postgresql+psycopg2://postgres.{ref}:{pw}@{host}:5432/postgres"
            f"?sslmode=require"
        )
        try:
            engine = create_engine(url, connect_args={"connect_timeout": 5})
            with engine.connect() as conn:
                conn.execute(text("SELECT 1"))
        except Exception:
            continue
        print(f"resolved session pooler host: {host}")
        github_env = os.environ.get("GITHUB_ENV")
        if github_env:
            with open(github_env, "a") as f:
                f.write(f"DATABASE_URL={url}\n")
        return 0

    print(
        "::error::Could not authenticate to any Supabase session pooler host — "
        "check SUPABASE_DB_PASSWORD (or set the full DATABASE_URL secret)"
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
