"""Device enrollment endpoints (#51): trust-on-first-use register.

The first account to enroll a fresh device claims it (active); a different
account enrolling an owned device lands in pending until an admin (email in
ADMIN_EMAILS) approves. Revocation refuses the device outright.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..config import Settings, get_settings
from ..db import get_db
from ..devices import STATUS_ACTIVE, STATUS_PENDING, STATUS_REVOKED, resolve_enrollment_status
from ..models import Device

router = APIRouter(prefix="/v1/devices", tags=["devices"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _require_admin(identity: Identity, settings: Settings) -> None:
    if identity.email.lower() not in settings.admin_email_list:
        raise HTTPException(status_code=403, detail="Admin access required")


def _record(d: Device) -> dict:
    return {
        "deviceId": d.device_id,
        "subject": d.subject,
        "status": d.status,
        "platform": d.platform,
        "model": d.model,
        "technicianEmail": d.technician_email,
        "enrolledAt": d.enrolled_at.isoformat() if d.enrolled_at else None,
        "approvedBy": d.approved_by,
    }


class EnrollBody(BaseModel):
    deviceId: str = Field(min_length=1, max_length=128)
    publicKeyPem: str = Field(min_length=1, max_length=4000)
    platform: str | None = Field(default=None, max_length=32)
    model: str | None = Field(default=None, max_length=128)


@router.post("/enroll")
def enroll(
    body: EnrollBody,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    rows = db.scalars(select(Device).where(Device.device_id == body.deviceId)).all()
    mine = next((r for r in rows if r.subject == identity.subject), None)

    if mine is not None:
        if mine.status == STATUS_REVOKED:
            raise HTTPException(status_code=403, detail="This device has been revoked for your account")
        # Reinstall on the owner's own device: the key rotates, ownership and
        # status stay as they were.
        mine.public_key_pem = body.publicKeyPem
        mine.platform = body.platform
        mine.model = body.model
        mine.updated_at = _now()
        db.commit()
        return {"status": mine.status}

    status = resolve_enrollment_status([r.status for r in rows])
    db.add(
        Device(
            device_id=body.deviceId,
            subject=identity.subject,
            public_key_pem=body.publicKeyPem,
            status=status,
            platform=body.platform,
            model=body.model,
            technician_email=identity.email or None,
        )
    )
    db.commit()
    return {"status": status}


@router.get("/mine")
def my_devices(
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    rows = db.scalars(select(Device).where(Device.subject == identity.subject)).all()
    return {"devices": [_record(r) for r in rows]}


class AdminDeviceBody(BaseModel):
    deviceId: str = Field(min_length=1, max_length=128)
    subject: str = Field(min_length=1, max_length=200)


@router.get("/pending")
def pending_devices(
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_admin(identity, settings)
    rows = db.scalars(select(Device).where(Device.status == STATUS_PENDING)).all()
    return {"devices": [_record(r) for r in rows]}


@router.post("/approve")
def approve_device(
    body: AdminDeviceBody,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_admin(identity, settings)
    row = db.scalar(
        select(Device).where(Device.device_id == body.deviceId, Device.subject == body.subject)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown device enrollment")
    row.status = STATUS_ACTIVE
    row.approved_by = identity.email
    row.approved_at = _now()
    row.updated_at = _now()
    db.commit()
    return {"device": _record(row)}


@router.post("/revoke")
def revoke_device(
    body: AdminDeviceBody,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
    settings: Settings = Depends(get_settings),
) -> dict:
    _require_admin(identity, settings)
    row = db.scalar(
        select(Device).where(Device.device_id == body.deviceId, Device.subject == body.subject)
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Unknown device enrollment")
    row.status = STATUS_REVOKED
    row.updated_at = _now()
    db.commit()
    return {"device": _record(row)}
