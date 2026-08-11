"""Syspro SQL Server client: named SELECTs only, no caller-supplied SQL.

We never write to Syspro. That is a promise the code keeps rather than an
intention it holds: every statement runs through `assert_select`, the
queries are module constants, and nothing on the call path accepts SQL
from a request.
"""
from __future__ import annotations

import re
from contextlib import contextmanager
from typing import Any, Iterator, Sequence

from ..config import Settings


class SysproError(RuntimeError):
    """Anything that stopped us reading. Carries no credential."""


# A statement is acceptable only if it is a single SELECT. Comments are
# stripped first so that "-- x\nDELETE" cannot masquerade as a comment,
# and the trailing-semicolon case is allowed but a second statement is
# not: batching is how a read path turns into a write path.
_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|merge|drop|truncate|alter|create|grant|revoke|exec|execute|sp_\w+|xp_\w+|into)\b",
    re.IGNORECASE,
)


def strip_comments(sql: str) -> str:
    return _BLOCK_COMMENT.sub(" ", _LINE_COMMENT.sub(" ", sql)).strip()


def assert_select(sql: str) -> None:
    """Raise unless `sql` is exactly one SELECT statement.

    Defence in depth. Today every query is a constant in this module, so
    this can only fire on a future edit, which is precisely when it is
    worth having."""
    bare = strip_comments(sql)
    if not bare:
        raise SysproError("empty statement")
    body = bare.rstrip().rstrip(";")
    if ";" in body:
        raise SysproError("batched statements are not allowed on the Syspro read path")
    if not re.match(r"^\s*(select|with)\b", body, re.IGNORECASE):
        raise SysproError("only SELECT is allowed on the Syspro read path")
    found = _FORBIDDEN.search(body)
    if found:
        raise SysproError(f"'{found.group(0)}' is not allowed on the Syspro read path")


@contextmanager
def _connect(settings: Settings) -> Iterator[Any]:
    if not settings.syspro_host:
        raise SysproError("SYSPRO_HOST is not set")
    try:
        import pymssql
    except ImportError as exc:  # pragma: no cover - image always carries it
        raise SysproError(f"pymssql is not installed: {exc}") from exc

    kwargs: dict[str, Any] = {
        "server": settings.syspro_host,
        "port": str(settings.syspro_port),
        "user": settings.syspro_user,
        # The login we were issued has no password (#133). An empty string
        # is the correct value to send, not None, which makes FreeTDS
        # attempt integrated auth and fail obscurely.
        "password": settings.syspro_password or "",
        "login_timeout": settings.syspro_login_timeout,
        "timeout": settings.syspro_query_timeout,
        "as_dict": True,
        # Measured, not chosen. Everything from the modern default down to
        # TDS 7.1 is refused by this endpoint with FreeTDS error 20002, and
        # only 7.0 with encryption off completes the handshake. See
        # /v1/syspro/diagnose and docs/SYSPRO-INTEGRATION.md.
        "encryption": settings.syspro_encryption,
    }
    if settings.syspro_tds_version:
        kwargs["tds_version"] = settings.syspro_tds_version
    # The database is NOT sent in the login packet. The login lands in its
    # own default database (master) and the queries name the company
    # database explicitly instead, which is the combination proven to
    # work here.
    try:
        connection = pymssql.connect(**kwargs)
    except Exception as exc:
        # Never let a driver exception carry the connection string.
        raise SysproError(f"{type(exc).__name__}: {_safe(str(exc), settings)}") from None
    try:
        yield connection
    finally:
        try:
            connection.close()
        except Exception:  # pragma: no cover - closing a dead socket
            pass


def _safe(message: str, settings: Settings) -> str:
    """Strip anything credential-shaped out of a driver message."""
    for secret in (settings.syspro_password, settings.syspro_user):
        if secret:
            message = message.replace(secret, "***")
    return message[:400]


class SysproClient:
    """Open connection per use. The catalogue is pulled a few times a day,
    so a pool would be complexity with nothing to show for it."""

    def __init__(self, settings: Settings):
        self._settings = settings

    def rows(self, sql: str, params: Sequence[Any] | None = None, limit: int | None = None) -> list[dict]:
        assert_select(sql)
        with _connect(self._settings) as connection:
            cursor = connection.cursor(as_dict=True)
            try:
                cursor.execute(sql, tuple(params) if params else None)
                if limit is None:
                    return list(cursor.fetchall())
                out: list[dict] = []
                for row in cursor:
                    out.append(row)
                    if len(out) >= limit:
                        break
                return out
            except Exception as exc:
                raise SysproError(f"{type(exc).__name__}: {_safe(str(exc), self._settings)}") from None
            finally:
                cursor.close()


# ---------------------------------------------------------------------------
# Named queries
# ---------------------------------------------------------------------------

# What the login can actually see. With a read-only account whose grants we
# did not set, this has to be discovered rather than assumed: a query
# against a table we cannot read fails as a permission error that reads
# like a missing table.
Q_IDENTITY = """
SELECT @@VERSION AS server_version,
       DB_NAME() AS database_name,
       SUSER_SNAME() AS login_name,
       CONVERT(varchar(30), SYSUTCDATETIME(), 126) AS server_utc
"""

# Prowalco gave us a server and a login, not a database name. Syspro names
# its company databases per company (SysproCompanyX and similar), so the
# name has to be discovered rather than guessed: naming the wrong one fails
# as "invalid object name InvWarehouse", which reads like a permissions
# problem and is not.
Q_DATABASES = """
SELECT name AS database_name
FROM sys.databases
WHERE HAS_DBACCESS(name) = 1
ORDER BY name
"""

# The company database is named in every query rather than sent in the
# login packet, because the login lands in master and only the no-database
# login completes the handshake against this endpoint.
_IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_]*$")


def qualify(database: str) -> str:
    """Validate a database name before it is interpolated into SQL.

    The value comes from configuration rather than a request, so this is
    not the last line of defence, but interpolating an unvalidated
    identifier into SQL is a habit worth not having."""
    if not _IDENTIFIER.match(database or ""):
        raise SysproError(f"'{database}' is not a valid database identifier")
    return database


def q_visible_tables(database: str) -> str:
    return f"""
SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name
FROM {qualify(database)}.INFORMATION_SCHEMA.TABLES
WHERE TABLE_NAME IN ('InvWarehouse', 'InvMaster', 'InvWhControl')
ORDER BY TABLE_NAME
"""


def q_catalogue(database: str) -> str:
    """The catalogue the picker needs, and nothing else.

    InvWarehouse carries 122 columns of sales history and aged balances
    (docs/SYSPRO-INTEGRATION.md); none of it belongs in a parts list, so
    none of it is selected.

    Schema-qualified with dbo on purpose. The login's default schema is
    not ours to assume, and an unqualified name that resolves somewhere
    unexpected fails as "invalid object name", which reads like a
    permissions problem.

    `company` is the database name as a literal rather than DB_NAME(),
    which would say `master`. Prowalco runs SysproCompanyRSA and, for
    Lesotho, SysproCompanyH. We only pull RSA today, because every van
    warehouse we have mapped is RSA, but a catalogue whose rows cannot say
    where they came from is one that cannot take the second company later
    without guesswork."""
    db = qualify(database)
    return f"""
SELECT '{db}'         AS company,
       w.StockCode    AS stock_code,
       w.Warehouse    AS warehouse,
       m.Description  AS description,
       m.StockUom     AS unit,
       w.QtyOnHand    AS qty_on_hand,
       w.UnitCost     AS unit_cost
FROM {db}.dbo.InvWarehouse w
LEFT JOIN {db}.dbo.InvMaster m ON m.StockCode = w.StockCode
WHERE w.QtyOnHand IS NOT NULL
"""


def q_warehouses(database: str) -> str:
    db = qualify(database)
    return f"""
SELECT Warehouse AS warehouse, COUNT(*) AS stock_codes
FROM {db}.dbo.InvWarehouse
GROUP BY Warehouse
ORDER BY Warehouse
"""


def diagnose(settings: Settings) -> dict:
    """Isolate WHERE a refused connection is refused.

    Written because the probe told us the firewall had opened (a fast
    protocol-level refusal replaced a 30-second packet drop) and then had
    nothing more to say. `Adaptive Server connection failed` is FreeTDS's
    catch-all: it covers a failed TLS negotiation, a TDS version the
    server will not speak, and a login the server rejects before it will
    say why. Those need different fixes and guessing between them costs a
    deploy each.

    Two parts. A raw TCP connect, which separates the network from
    everything above it for certain. Then a small matrix of encryption
    and TDS settings, each reported with its own error, plus a variant
    that omits the database: a login whose default database is not
    accessible fails AT LOGIN, which looks nothing like a database
    problem and is a real possibility for an account we did not create."""
    import socket
    import time

    host = settings.syspro_host
    port = settings.syspro_port
    out: dict[str, Any] = {"host": host, "port": port}

    started = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=15):
            out["tcp"] = {"ok": True, "seconds": round(time.monotonic() - started, 2)}
    except Exception as exc:
        out["tcp"] = {
            "ok": False,
            "seconds": round(time.monotonic() - started, 2),
            "error": f"{type(exc).__name__}: {exc}",
        }
        out["attempts"] = []
        return out

    try:
        import pymssql
    except ImportError as exc:
        out["attempts"] = [{"error": f"pymssql is not installed: {exc}"}]
        return out

    # Newest protocol first, so the FIRST success is the best available
    # rather than merely the first that works. TDS 7.0 predates several
    # data types, so settling for it when 7.2 would connect is a bug that
    # only shows up later as a truncated or mistyped column.
    matrix = [
        {"encryption": "request", "use_database": True},
        {"encryption": "off", "use_database": True},
        {"encryption": "off", "use_database": False, "tds_version": "7.4"},
        {"encryption": "off", "use_database": False, "tds_version": "7.3"},
        {"encryption": "off", "use_database": False, "tds_version": "7.2"},
        {"encryption": "off", "use_database": False, "tds_version": "7.1"},
        {"encryption": "off", "use_database": False, "tds_version": "7.0"},
        {"encryption": "off", "use_database": True, "tds_version": "7.0"},
    ]

    attempts: list[dict] = []
    for spec in matrix:
        kwargs: dict[str, Any] = {
            "server": host,
            "port": str(port),
            "user": settings.syspro_user,
            "password": settings.syspro_password or "",
            "login_timeout": 8,
            "timeout": 8,
            "encryption": spec["encryption"],
        }
        if spec["use_database"] and settings.syspro_database:
            kwargs["database"] = settings.syspro_database
        if spec.get("tds_version"):
            kwargs["tds_version"] = spec["tds_version"]

        label = {k: v for k, v in spec.items()}
        began = time.monotonic()
        try:
            connection = pymssql.connect(**kwargs)
            try:
                cursor = connection.cursor(as_dict=True)
                cursor.execute("SELECT DB_NAME() AS database_name, SUSER_SNAME() AS login_name")
                row = cursor.fetchone()
                cursor.close()
            finally:
                connection.close()
            attempts.append(
                {**label, "ok": True, "seconds": round(time.monotonic() - began, 2), "result": row}
            )
            # First success is the answer; no reason to keep knocking.
            break
        except Exception as exc:
            attempts.append(
                {
                    **label,
                    "ok": False,
                    "seconds": round(time.monotonic() - began, 2),
                    "error": f"{type(exc).__name__}: {_safe(str(exc), settings)}",
                }
            )

    out["attempts"] = attempts
    out["connected"] = any(a.get("ok") for a in attempts)
    return out


def probe(settings: Settings, sample: int = 20) -> dict:
    """Connect and report what is reachable, step by step.

    Deliberately does not raise on a failed step. The point of a probe is
    to say WHICH part failed: a timeout means the allowlist still does not
    have us, a login error means the credential, and a permission error on
    one table means the grants. Collapsing those into one 500 is how a
    diagnosis turns into a guess."""
    client = SysproClient(settings)
    result: dict[str, Any] = {
        "host": settings.syspro_host or None,
        "port": settings.syspro_port,
        "database": settings.syspro_database or None,
        "user": settings.syspro_user or None,
        "steps": {},
    }
    steps: dict[str, Any] = result["steps"]

    database = settings.syspro_database
    for name, sql, limit in (
        ("identity", Q_IDENTITY, None),
        ("databases", Q_DATABASES, 100),
        ("visible_tables", q_visible_tables(database), None),
        ("warehouses", q_warehouses(database), 50),
        ("catalogue_sample", q_catalogue(database), sample),
    ):
        try:
            rows = client.rows(sql, limit=limit)
            steps[name] = {"ok": True, "rowCount": len(rows), "rows": rows}
        except SysproError as exc:
            steps[name] = {"ok": False, "error": str(exc)}
            # A failed identity step means there is no connection at all,
            # so the rest would only repeat the same timeout.
            if name == "identity":
                break

    result["connected"] = bool(steps.get("identity", {}).get("ok"))
    return result
