"""The Syspro read path must not be able to write (#135).

Every query on this path is a module constant today, so these tests can
only fire on a future edit. That is exactly when they earn their keep:
the login we were given sits behind nothing but a source IP allowlist
(#133), so a write reaching Syspro would be both possible and ours."""
import pytest

from app.syspro.client import (
    Q_DATABASES,
    Q_IDENTITY,
    SysproError,
    assert_select,
    q_catalogue,
    q_visible_tables,
    q_warehouses,
    qualify,
    strip_comments,
)

_DB = "SysproCompanyRSA"


@pytest.mark.parametrize(
    "sql",
    [
        Q_IDENTITY,
        Q_DATABASES,
        q_visible_tables(_DB),
        q_catalogue(_DB),
        q_warehouses(_DB),
    ],
)
def test_shipped_queries_pass_the_guard(sql):
    assert_select(sql)


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM InvWarehouse",
        "UPDATE InvMaster SET Description = 'x'",
        "INSERT INTO InvWarehouse (StockCode) VALUES ('x')",
        "DROP TABLE InvMaster",
        "TRUNCATE TABLE InvWarehouse",
        "MERGE InvMaster AS t USING x AS s ON 1=1",
        "GRANT SELECT ON InvMaster TO public",
        "EXEC sp_who",
        "SELECT * INTO Copy FROM InvMaster",
    ],
)
def test_writes_are_refused(sql):
    with pytest.raises(SysproError):
        assert_select(sql)


def test_batched_statements_are_refused():
    # The classic escape: a legitimate SELECT with a second statement
    # riding behind it.
    with pytest.raises(SysproError, match="batched"):
        assert_select("SELECT 1; DELETE FROM InvMaster")


def test_a_single_trailing_semicolon_is_fine():
    assert_select("SELECT 1;")


def test_a_comment_cannot_hide_a_write():
    with pytest.raises(SysproError):
        assert_select("-- harmless\nDELETE FROM InvMaster")
    with pytest.raises(SysproError):
        assert_select("/* harmless */ DELETE FROM InvMaster")


def test_comment_stripping_leaves_the_statement():
    assert strip_comments("/* a */ SELECT 1 -- b").strip() == "SELECT 1"


def test_empty_is_refused():
    with pytest.raises(SysproError):
        assert_select("   -- nothing here\n  ")


@pytest.mark.parametrize(
    "name",
    ["Sys pro", "master;DROP", "1Company", "", "dbo.InvMaster", "Company-RSA", "Company'"],
)
def test_a_bad_database_identifier_is_refused(name):
    # The name comes from configuration rather than a request, so this is
    # not the last line of defence. Interpolating an unvalidated
    # identifier into SQL is still a habit worth not having.
    with pytest.raises(SysproError):
        qualify(name)


def test_a_good_database_identifier_passes():
    assert qualify("SysproCompanyRSA") == "SysproCompanyRSA"
    assert qualify("SysproCompanyH") == "SysproCompanyH"


def test_queries_name_the_company_database():
    # The login lands in master, so an unqualified table name would
    # resolve there and fail as "invalid object name".
    assert "SysproCompanyRSA.dbo.InvWarehouse" in q_catalogue(_DB)
    assert "SysproCompanyRSA.INFORMATION_SCHEMA.TABLES" in q_visible_tables(_DB)


def test_error_message_carries_no_credential():
    from app.config import Settings
    from app.syspro.client import _safe

    settings = Settings(syspro_user="STAFF", syspro_password="hunter2")
    assert "hunter2" not in _safe("login failed for STAFF/hunter2", settings)


# --- paging (#136) ---


def test_first_page_has_no_keyset_predicate():
    from app.syspro.ingest import q_catalogue_page

    sql = q_catalogue_page(_DB, 100)
    assert_select(sql)
    assert "TOP (100)" in sql
    assert "w.StockCode >" not in sql


def test_later_pages_carry_the_keyset():
    from app.syspro.ingest import q_catalogue_page

    sql = q_catalogue_page(_DB, 100, after_code="ABC", after_warehouse="AA")
    assert_select(sql)
    # OFFSET/FETCH arrived in SQL Server 2012 and this server is 2008 R2,
    # so keyset is the only option, not merely the better one.
    assert "OFFSET" not in sql.upper()
    assert "w.StockCode > %s" in sql


def test_page_size_is_bounded():
    from app.syspro.ingest import q_catalogue_page

    for bad in (0, -1, 50001):
        with pytest.raises(SysproError):
            q_catalogue_page(_DB, bad)


def test_numeric_cast_refuses_rubbish_rather_than_zeroing():
    from decimal import Decimal

    from app.syspro.ingest import _num

    # TDS 7.0 delivers numerics as strings, so every value needs this.
    assert _num("18.000000") == Decimal("18.000000")
    assert _num(" 151.03 ") == Decimal("151.03")
    assert _num(None) is None
    # None means "reject the row". A zero would read as an empty van.
    assert _num("not a number") is None
    assert _num("") is None
