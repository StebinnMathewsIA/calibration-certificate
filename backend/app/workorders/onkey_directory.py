"""Technician resolution over the mined WOE001 registers (#55, #57).

The signed-in email is the join key. Demo alias emails
(ONKEY_DEMO_ALIAS_EMAILS) resolve dynamically to whichever technician
currently has the most open work orders, so test accounts always ride the
richest real dataset. Ordinary emails resolve via onkey_technicians.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings

# Owner-designated open statuses (#55) — the ones that appear on Home,
# one section per status, in this order.
OPEN_STATUSES = [
    "To be Planned",
    "Allocated",
    "Incomplete for Spares",
    "Work Order Received",
    "Referral",
    "Work Resumed",
]


def busiest_open_technician(db: Session) -> dict | None:
    """Staff code + open-WO count of the technician with the most open work
    orders. Callers must NOT log name/email (public repo; POPIA)."""
    row = db.execute(
        text(
            """
            SELECT w.staff_code, count(*) AS open_count
            FROM onkey_workorders w
            WHERE w.status_description = ANY(:open) AND w.staff_code IS NOT NULL
            GROUP BY w.staff_code
            ORDER BY open_count DESC, w.staff_code
            LIMIT 1
            """
        ),
        {"open": OPEN_STATUSES},
    ).first()
    if row is None:
        return None
    return {"staffCode": row[0], "openCount": row[1]}


def resolve_staff_code_for_email(db: Session, settings: Settings, email: str) -> str | None:
    """The staff code whose work orders the given sign-in email should see."""
    normalized = (email or "").strip().lower()
    if not normalized:
        return None
    if normalized in settings.onkey_demo_alias_email_list:
        busiest = busiest_open_technician(db)
        return busiest["staffCode"] if busiest else None
    return db.execute(
        text("SELECT staff_code FROM onkey_technicians WHERE lower(email) = :email LIMIT 1"),
        {"email": normalized},
    ).scalar()
