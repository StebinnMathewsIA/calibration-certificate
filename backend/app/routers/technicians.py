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


def _record(row) -> dict:
    return {
        "staffCode": row.staff_code,
        "name": row.name,
        "firstName": row.first_name,
        "lastName": row.last_name,
        "email": row.email,
        "manager": row.manager,
        "pliersNumber": row.pliers_number,
    }


def _direct_row(db: Session, email: str):
    if not email:
        return None
    return db.execute(
        text("SELECT * FROM onkey_technicians WHERE lower(email) = :em"),
        {"em": email.strip().lower()},
    ).first()


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
        "technician": _record(row),
        # Aliases ride someone else's record and may not edit it.
        "editable": bool(direct is not None and direct.staff_code == staff_code),
    }


class TechnicianPatch(BaseModel):
    firstName: str | None = Field(default=None, max_length=100)
    lastName: str | None = Field(default=None, max_length=100)
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
    updates = {
        column: value.strip()
        for column, value in {
            "first_name": body.firstName,
            "last_name": body.lastName,
            "pliers_number": body.pliersNumber,
        }.items()
        if value is not None and value.strip()
    }
    if not updates:
        raise HTTPException(status_code=422, detail="No fields to update")
    set_clause = ", ".join(f"{column} = :{column}" for column in updates)
    db.execute(
        text(
            f"UPDATE onkey_technicians SET {set_clause}, updated_at = now() "  # noqa: S608
            "WHERE staff_code = :sc"
        ),
        {**updates, "sc": row.staff_code},
    )
    db.commit()
    fresh = db.execute(
        text("SELECT * FROM onkey_technicians WHERE staff_code = :sc"), {"sc": row.staff_code}
    ).first()
    return {"technician": _record(fresh), "editable": True}
