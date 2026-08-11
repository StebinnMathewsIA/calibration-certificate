"""The Syspro read path must not be able to write (#135).

Every query on this path is a module constant today, so these tests can
only fire on a future edit. That is exactly when they earn their keep:
the login we were given sits behind nothing but a source IP allowlist
(#133), so a write reaching Syspro would be both possible and ours."""
import pytest

from app.syspro.client import (
    Q_CATALOGUE,
    Q_DATABASES,
    Q_IDENTITY,
    Q_VISIBLE_TABLES,
    Q_WAREHOUSES,
    SysproError,
    assert_select,
    strip_comments,
)


@pytest.mark.parametrize(
    "sql", [Q_IDENTITY, Q_DATABASES, Q_VISIBLE_TABLES, Q_CATALOGUE, Q_WAREHOUSES]
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


def test_error_message_carries_no_credential():
    from app.config import Settings
    from app.syspro.client import _safe

    settings = Settings(syspro_user="STAFF", syspro_password="hunter2")
    assert "hunter2" not in _safe("login failed for STAFF/hunter2", settings)
