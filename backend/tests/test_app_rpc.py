"""Direct-read RPC functions (Architecture v2 phase 1, #65).

Runs against the real Supabase project like the rest of the suite. Data
assertions are register-independent: they simulate JWT claims via the
request.jwt.claims GUC and verify behavior/shape, not specific rows.
"""
import json

import pytest
from sqlalchemy import text

from app.db import SessionLocal


@pytest.fixture()
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.rollback()
        session.close()


def _as_email(db, email: str) -> None:
    db.execute(
        text("SET request.jwt.claims = :claims"),
        {"claims": json.dumps({"email": email})},
    )


def test_unknown_email_sees_nothing(db):
    _as_email(db, "nobody@example.invalid")
    assert db.execute(text("SELECT app_staff_code()")).scalar() is None
    assert db.execute(text("SELECT app_my_work_orders()")).scalar() == []
    assert db.execute(text("SELECT app_my_sites()")).scalar() == []
    assert db.execute(text("SELECT app_my_technician()")).scalar() is None


def test_admin_view_as(db):
    """Roles + view-as (#71): the seeded admin has no scope until a view-as
    is set; setting one makes the whole read surface resolve to that
    technician; clearing returns to none. Non-role users are refused."""
    _as_email(db, "stebinn@gmail.com")
    assert db.execute(text("SELECT app_role()")).scalar() == "admin"
    db.execute(text("SELECT app_set_view_as(NULL)"))
    db.commit()
    assert db.execute(text("SELECT app_staff_code()")).scalar() is None

    some_tech = db.execute(
        text("SELECT staff_code FROM onkey_technicians LIMIT 1")
    ).scalar()
    if some_tech:
        db.execute(text("SELECT app_set_view_as(:sc)"), {"sc": some_tech})
        db.commit()
        assert db.execute(text("SELECT app_staff_code()")).scalar() == some_tech
        wos = db.execute(text("SELECT app_my_work_orders()")).scalar()
        for wo in wos:
            assert wo["status"] == "open"
            assert wo["staffCode"] == some_tech
        db.execute(text("SELECT app_set_view_as(NULL)"))
        db.commit()

    compliance = db.execute(text("SELECT app_measures_compliance()")).scalar()
    assert compliance is not None
    assert set(compliance) == {"total", "compliant", "issues"}

    _as_email(db, "nobody@example.invalid")
    assert db.execute(text("SELECT app_measures_compliance()")).scalar() is None
    with pytest.raises(Exception, match="requires a manager or admin role"):
        db.execute(text("SELECT app_set_view_as('X')"))
    db.rollback()


def test_dispenser_detail_defaults_when_never_saved(db):
    detail = db.execute(
        text("SELECT app_dispenser_detail('___never-saved___')")
    ).scalar()
    assert detail == {
        "dispenserId": "___never-saved___",
        "qMinLpm": None,
        "qMaxLpm": None,
        "hoses": [],
    }


def test_bundle_rejects_unknown_and_unassigned(db):
    _as_email(db, "nobody@example.invalid")
    with pytest.raises(Exception, match="Unknown work order"):
        db.execute(text("SELECT app_work_order_bundle('___nope___')"))
    db.rollback()
    _as_email(db, "nobody@example.invalid")
    some_wo = db.execute(
        text("SELECT code FROM onkey_workorders WHERE staff_code IS NOT NULL LIMIT 1")
    ).scalar()
    if some_wo:
        with pytest.raises(Exception, match="not assigned"):
            db.execute(
                text("SELECT app_work_order_bundle(:c)"), {"c": some_wo}
            )


def test_sync_pull_shape(db):
    """One-round-trip mirror pull (#66): full shape for a nobody, and — when
    the registers hold data — a consistent scope for the demo alias."""
    _as_email(db, "nobody@example.invalid")
    pull = db.execute(text("SELECT app_sync_pull()")).scalar()
    assert set(pull) == {
        "technician", "workOrders", "sites", "siteDispensers",
        "dispenserDetails", "syncedAt",
    }
    assert pull["workOrders"] == [] and pull["sites"] == {}

    _as_email(db, "stebinn@gmail.com")
    pull = db.execute(text("SELECT app_sync_pull()")).scalar()
    for wo in pull["workOrders"]:
        if wo["siteId"]:
            assert wo["siteId"] in pull["sites"]
            assert wo["siteId"] in pull["siteDispensers"]


def test_certificate_history(db):
    """Archive history (#68): empty for unknown ids; when certificates are
    indexed, the site rows carry the expected metadata shape."""
    assert db.execute(text("SELECT app_site_history('___nope___')")).scalar() == []
    assert db.execute(text("SELECT app_dispenser_history('___nope___')")).scalar() == []
    indexed = db.execute(
        text("SELECT site_id FROM certificates WHERE site_id IS NOT NULL LIMIT 1")
    ).scalar()
    if indexed:
        rows = db.execute(
            text("SELECT app_site_history(:s)"), {"s": indexed}
        ).scalar()
        assert rows
        assert set(rows[0]) >= {
            "certificateNumber", "dispenserId", "signedAt", "status", "voName",
        }


def test_insights_shape(db):
    """Insights (#56): full shape for a nobody (all zeros, company snapshot
    still present); consistent totals for the demo alias."""
    _as_email(db, "nobody@example.invalid")
    ins = db.execute(text("SELECT app_insights()")).scalar()
    assert set(ins) == {"me", "certificates", "company", "generatedAt"}
    assert ins["me"]["openTotal"] == 0
    assert ins["certificates"]["issuedByMe"] == 0
    assert ins["company"]["openTotal"] >= 0

    _as_email(db, "stebinn@gmail.com")
    ins = db.execute(text("SELECT app_insights()")).scalar()
    assert ins["me"]["openTotal"] == sum(ins["me"]["openByStatus"].values())
    assert ins["me"]["openTotal"] <= ins["company"]["openTotal"]


def test_measures_register_shape(db):
    """Certified measures register (#70): blank for a nobody; active is a
    subset of history; the technician record's measures mirror the table."""
    _as_email(db, "nobody@example.invalid")
    m = db.execute(text("SELECT app_my_measures()")).scalar()
    assert m == {"active": [], "history": []}

    _as_email(db, "stebinn@gmail.com")
    m = db.execute(text("SELECT app_my_measures()")).scalar()
    active_ids = {row["id"] for row in m["active"]}
    history_ids = {row["id"] for row in m["history"]}
    assert active_ids <= history_ids
    tech = db.execute(text("SELECT app_my_technician()")).scalar()
    if tech is not None:
        assert {row["id"] for row in tech["technician"]["measures"]} == active_ids


def test_api_roles_are_locked_down(db):
    """authenticated: no direct table reads, but RPC executes; anon: nothing."""
    _as_email(db, "nobody@example.invalid")
    db.execute(text("SET LOCAL ROLE authenticated"))
    with pytest.raises(Exception, match="permission denied"):
        db.execute(text("SELECT count(*) FROM onkey_technicians"))
    db.rollback()

    _as_email(db, "nobody@example.invalid")
    db.execute(text("SET LOCAL ROLE authenticated"))
    assert db.execute(text("SELECT app_my_work_orders()")).scalar() == []
    db.rollback()

    db.execute(text("SET LOCAL ROLE anon"))
    with pytest.raises(Exception, match="permission denied"):
        db.execute(text("SELECT app_my_work_orders()"))
    db.rollback()
