"""Technician self-profile from the mined register (#62).

GET resolves the sign-in email like everything else (demo aliases ride the
busiest technician, read-only). PATCH requires a DIRECT email match — an
alias account must never rename the real technician it rides.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..config import Settings, get_settings
from ..db import get_db
from ..workorders.onkey_directory import resolve_staff_code_for_email

router = APIRouter(prefix="/v1/technicians", tags=["technicians"])


def _active_measures(db: Session, staff_code: str) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT * FROM technician_measures "
            "WHERE staff_code = :sc AND status = 'active' ORDER BY size"
        ),
        {"sc": staff_code},
    ).all()
    return [
        {
            "id": m.id,
            "size": m.size,
            "serialNumber": m.serial_number,
            "certificateNumber": m.certificate_number,
            "calibrationDate": m.calibration_date.isoformat() if m.calibration_date else None,
            "expiryDate": m.expiry_date.isoformat(),
            "status": m.status,
        }
        for m in rows
    ]


def _record(db: Session, row) -> dict:
    return {
        "staffCode": row.staff_code,
        "name": row.name,
        "firstName": row.first_name,
        "lastName": row.last_name,
        "email": row.email,
        "manager": row.manager,
        "pliersNumber": row.pliers_number,
        # Measures come from the certified register (#70), not the
        # deprecated jsonb column.
        "measures": _active_measures(db, row.staff_code),
    }


def _direct_row(db: Session, email: str):
    if not email:
        return None
    return db.execute(
        text("SELECT * FROM onkey_technicians WHERE lower(email) = :em"),
        {"em": email.strip().lower()},
    ).first()


def _admin_view_as_target(db: Session, email: str) -> str | None:
    """Staff code an ADMIN is actively viewing as (#79); None for everyone
    else. Managers stay read-only: measure setup is an admin duty."""
    em = (email or "").strip().lower()
    if not em:
        return None
    role = db.execute(
        text("SELECT role FROM app_roles WHERE email = :em"), {"em": em}
    ).scalar()
    if role != "admin":
        return None
    return db.execute(
        text("SELECT staff_code FROM app_view_as WHERE email = :em"), {"em": em}
    ).scalar()


@router.get("/me")
def my_technician(
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
    settings: Settings = Depends(get_settings),
) -> dict:
    staff_code = resolve_staff_code_for_email(db, settings, identity.email)
    if not staff_code:
        raise HTTPException(status_code=404, detail="No technician record for this account")
    row = db.execute(
        text("SELECT * FROM onkey_technicians WHERE staff_code = :sc"), {"sc": staff_code}
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="No technician record for this account")
    direct = _direct_row(db, identity.email)
    return {
        "technician": _record(db, row),
        # Aliases ride someone else's record and may not edit it.
        "editable": bool(direct is not None and direct.staff_code == staff_code),
    }


MEASURE_SIZES = ("200L", "20L", "5L")


class MeasureBody(BaseModel):
    """A newly certified proving measure (#70). Adding one supersedes the
    previous measure of that size — history is never deleted. Photos stay
    on-device."""

    size: str = Field(max_length=8)
    serialNumber: str = Field(min_length=1, max_length=64)
    certificateNumber: str = Field(min_length=1, max_length=64)
    calibrationDate: str = Field(min_length=10, max_length=10)
    expiryDate: str = Field(min_length=10, max_length=10)


class TechnicianPatch(BaseModel):
    """Self-service fields (#63): pliers number. Names come from the
    register; measures go through POST /me/measures (#70)."""

    pliersNumber: str | None = Field(default=None, max_length=64)


@router.patch("/me")
def patch_my_technician(
    body: TechnicianPatch,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    row = _direct_row(db, identity.email)
    if row is None:
        raise HTTPException(
            status_code=403,
            detail="Only the technician's own sign-in may edit their record",
        )
    if body.pliersNumber is None or not body.pliersNumber.strip():
        raise HTTPException(status_code=422, detail="No fields to update")
    db.execute(
        text(
            "UPDATE onkey_technicians SET pliers_number = :pn, updated_at = now() "
            "WHERE staff_code = :sc"
        ),
        {"pn": body.pliersNumber.strip(), "sc": row.staff_code},
    )
    db.commit()
    fresh = db.execute(
        text("SELECT * FROM onkey_technicians WHERE staff_code = :sc"), {"sc": row.staff_code}
    ).first()
    return {"technician": _record(db, fresh), "editable": True}


@router.post("/me/measures")
def add_measure(
    body: MeasureBody,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    """Registers a newly certified proving measure (#70): the previous
    active measure of that size is superseded (kept as history), never
    deleted. Technicians register their own (direct email match); an admin
    with an active view-as selection registers for the viewed technician
    (#79), with added_by recording the admin for the audit trail."""
    row = _direct_row(db, identity.email)
    if row is not None:
        staff_code = row.staff_code
    else:
        staff_code = _admin_view_as_target(db, identity.email)
        if staff_code is None:
            raise HTTPException(
                status_code=403,
                detail=(
                    "Only the technician's own sign-in, or an admin viewing "
                    "as them, may register measures"
                ),
            )
    if body.size not in MEASURE_SIZES:
        raise HTTPException(status_code=422, detail=f"size must be one of {MEASURE_SIZES}")
    db.execute(
        text(
            "UPDATE technician_measures SET status = 'superseded', superseded_at = now() "
            "WHERE staff_code = :sc AND size = :size AND status = 'active'"
        ),
        {"sc": staff_code, "size": body.size},
    )
    db.execute(
        text(
            "INSERT INTO technician_measures "
            "(staff_code, size, serial_number, certificate_number, calibration_date, "
            " expiry_date, added_by) "
            "VALUES (:sc, :size, :serial, :cert, cast(:cal as date), cast(:exp as date), :by)"
        ),
        {
            "sc": staff_code,
            "size": body.size,
            "serial": body.serialNumber.strip(),
            "cert": body.certificateNumber.strip(),
            "cal": body.calibrationDate,
            "exp": body.expiryDate,
            "by": identity.email,
        },
    )
    db.commit()
    return {"measures": _active_measures(db, staff_code)}
