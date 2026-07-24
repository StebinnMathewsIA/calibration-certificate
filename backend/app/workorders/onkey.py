"""OnKeyProvider (#55): serves the app from the registers mined out of the
WOE001 sync — onkey_workorders / onkey_sites / onkey_equipment /
onkey_technicians. No SOAP here; the sync job is the only OnKey caller.

The signed-in email resolves to a staff code (demo aliases ride the busiest
technician, #57); the provider serves that technician's OPEN work orders
(owner's six open statuses). Field gaps the export cannot fill — dispenser
make/model/serial, site telephone — come back blank, and the existing
complete-on-site flow captures them into the canonical store.
"""
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import SessionLocal
from .onkey_directory import OPEN_STATUSES, resolve_staff_code_for_email
from .provider import WorkOrderProvider

_UNASSIGNED = "unassigned@prowalco.invalid"


def _wo_seed(row) -> dict:
    seed = {
        "id": row.code,
        "reference": row.code,
        "assignedTechnicianEmail": (row.email or _UNASSIGNED).lower(),
        "siteId": row.site_number or "",
        "dispenserIds": [row.equipment_number] if row.equipment_number else [],
        "status": "open" if row.status_description in OPEN_STATUSES else "completed",
        "statusDetail": row.status_description,
        "staffCode": row.staff_code,
    }
    if row.required_by is not None:
        seed["scheduledDate"] = row.required_by.date().isoformat()
    return seed


def _site_seed(row) -> dict:
    seed = {"id": row.site_number}
    # Oil company is the customer (owner-confirmed, #58); technician-facing
    # names/addresses fall back to blanks the on-site flow completes.
    if row.oil_company_name:
        seed["customerName"] = row.oil_company_name
    if row.site_name:
        seed["siteName"] = row.site_name
    if row.address:
        seed["address"] = row.address
    if row.telephone:
        seed["telephone"] = row.telephone
    return seed


def _equipment_seed(row) -> dict:
    # Make/model/serial are not in WOE001 — the identity screen completes them.
    return {"id": row.equipment_number, "siteId": row.site_number or ""}


class OnKeyProvider(WorkOrderProvider):
    def __init__(self, settings: Settings):
        self._settings = settings

    def _db(self) -> Session:
        return SessionLocal()

    def list_work_orders(self, technician_email: str) -> list[dict]:
        db = self._db()
        try:
            staff_code = resolve_staff_code_for_email(db, self._settings, technician_email)
            if not staff_code:
                return []
            rows = db.execute(
                text(
                    """
                    SELECT w.*, t.email
                    FROM onkey_workorders w
                    LEFT JOIN onkey_technicians t ON t.staff_code = w.staff_code
                    WHERE w.staff_code = :sc AND w.status_description = ANY(:open)
                    ORDER BY w.required_by NULLS LAST, w.code
                    """
                ),
                {"sc": staff_code, "open": OPEN_STATUSES},
            ).all()
            return [_wo_seed(r) for r in rows]
        finally:
            db.close()

    def get_work_order(self, work_order_id: str) -> dict | None:
        db = self._db()
        try:
            row = db.execute(
                text(
                    """
                    SELECT w.*, t.email
                    FROM onkey_workorders w
                    LEFT JOIN onkey_technicians t ON t.staff_code = w.staff_code
                    WHERE w.code = :code
                    """
                ),
                {"code": work_order_id},
            ).first()
            return _wo_seed(row) if row else None
        finally:
            db.close()

    def get_site(self, site_id: str) -> dict | None:
        db = self._db()
        try:
            row = db.execute(
                text("SELECT * FROM onkey_sites WHERE site_number = :sn"), {"sn": site_id}
            ).first()
            return _site_seed(row) if row else None
        finally:
            db.close()

    def get_dispenser(self, dispenser_id: str) -> dict | None:
        db = self._db()
        try:
            row = db.execute(
                text("SELECT * FROM onkey_equipment WHERE equipment_number = :en"),
                {"en": dispenser_id},
            ).first()
            return _equipment_seed(row) if row else None
        finally:
            db.close()

    def list_dispensers(self, site_id: str) -> list[dict]:
        db = self._db()
        try:
            rows = db.execute(
                text("SELECT * FROM onkey_equipment WHERE site_number = :sn ORDER BY equipment_number"),
                {"sn": site_id},
            ).all()
            return [_equipment_seed(r) for r in rows]
        finally:
            db.close()

    def list_sites_for_technician(self, technician_email: str) -> list[dict]:
        db = self._db()
        try:
            staff_code = resolve_staff_code_for_email(db, self._settings, technician_email)
            if not staff_code:
                return []
            rows = db.execute(
                text(
                    """
                    SELECT DISTINCT s.*
                    FROM onkey_workorders w
                    JOIN onkey_sites s ON s.site_number = w.site_number
                    WHERE w.staff_code = :sc AND w.status_description = ANY(:open)
                    ORDER BY s.site_number
                    """
                ),
                {"sc": staff_code, "open": OPEN_STATUSES},
            ).all()
            return [_site_seed(r) for r in rows]
        finally:
            db.close()
