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


def test_alias_resolves_to_busiest_technician(db):
    _as_email(db, "stebinn@gmail.com")
    code = db.execute(text("SELECT app_staff_code()")).scalar()
    has_open = db.execute(
        text(
            "SELECT EXISTS (SELECT 1 FROM onkey_workorders "
            "WHERE status_description = ANY (app_open_statuses()) "
            "AND staff_code IS NOT NULL)"
        )
    ).scalar()
    if has_open:
        assert code is not None
        wos = db.execute(text("SELECT app_my_work_orders()")).scalar()
        assert isinstance(wos, list)
        for wo in wos:
            assert wo["status"] == "open"
            assert set(wo) >= {"id", "siteId", "site", "statusDetail", "staffCode"}
    else:
        assert code is None


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
