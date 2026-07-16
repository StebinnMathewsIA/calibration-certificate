"""Work orders, sites, and dispensers — the OnKey object split.

Reads merge the read-only OnKey seed with our canonical store using the
resolution rule from the approved plan:

    our stored record  ->  OnKey seed  ->  blank (technician enters)

Writes (add/edit/retire a dispenser, complete a site, save the component
register) persist to our canonical store, so the next visit prefills from us.
Nothing is ever written back to OnKey.
"""
from datetime import datetime, timezone

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Identity, get_identity
from ..db import get_db
from ..models import Dispenser, DispenserDetail, Site
from ..workorders.provider import WorkOrderProvider
from ..workorders.simulated import get_provider

router = APIRouter(prefix="/v1", tags=["workorders"])


def get_workorder_provider() -> WorkOrderProvider:
    return get_provider()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# Serialisation (ORM -> camelCase record dicts)
# ---------------------------------------------------------------------------


def _site_record(site: Site) -> dict:
    return {
        "id": site.id,
        "customerName": site.customer_name,
        "siteName": site.site_name,
        "address": site.address,
        "telephone": site.telephone,
        "source": site.source,
        "updatedAt": site.updated_at.isoformat() if site.updated_at else None,
    }


def _site_from_seed(seed: dict) -> dict:
    """A seed mapped into the record shape (unpersisted; blanks stay blank)."""
    return {
        "id": seed["id"],
        "customerName": seed.get("customerName", ""),
        "siteName": seed.get("siteName", ""),
        "address": seed.get("address", ""),
        "telephone": seed.get("telephone"),
        "source": "onkey",
        "updatedAt": None,
        "inStore": False,
    }


def _dispenser_record(d: Dispenser) -> dict:
    return {
        "id": d.id,
        "siteId": d.site_id,
        "make": d.make,
        "model": d.model,
        "serialNumber": d.serial_number,
        "saApprovalNumber": d.sa_approval_number,
        "status": d.status,
        "source": d.source,
        "addedBy": d.added_by,
        "addedAt": d.added_at.isoformat() if d.added_at else None,
        "retiredBy": d.retired_by,
        "retiredAt": d.retired_at.isoformat() if d.retired_at else None,
        "updatedAt": d.updated_at.isoformat() if d.updated_at else None,
        "inStore": True,
    }


def _dispenser_from_seed(seed: dict) -> dict:
    return {
        "id": seed["id"],
        "siteId": seed["siteId"],
        "make": seed.get("make", ""),
        "model": seed.get("model", ""),
        "serialNumber": seed.get("serialNumber", ""),
        "saApprovalNumber": seed.get("saApprovalNumber", ""),
        "status": "active",
        "source": "onkey",
        "addedBy": None,
        "addedAt": None,
        "retiredBy": None,
        "retiredAt": None,
        "updatedAt": None,
        "inStore": False,
    }


# ---------------------------------------------------------------------------
# Resolution (store wins over seed)
# ---------------------------------------------------------------------------


def _resolve_site(db: Session, provider: WorkOrderProvider, site_id: str) -> dict | None:
    stored = db.get(Site, site_id)
    if stored is not None:
        return _site_record(stored)
    seed = provider.get_site(site_id)
    return _site_from_seed(seed) if seed else None


def _resolve_dispensers(db: Session, provider: WorkOrderProvider, work_order: dict) -> list[dict]:
    site_id = work_order["siteId"]
    # Union of the WO's seed dispensers and any canonical dispensers at the site
    # (e.g. ones the technician added that OnKey doesn't know about).
    stored = {
        d.id: d
        for d in db.scalars(select(Dispenser).where(Dispenser.site_id == site_id)).all()
    }
    order: list[str] = list(work_order.get("dispenserIds", []))
    for did in stored:
        if did not in order:
            order.append(did)

    out: list[dict] = []
    for did in order:
        if did in stored:
            out.append(_dispenser_record(stored[did]))
        else:
            seed = provider.get_dispenser(did)
            if seed:
                out.append(_dispenser_from_seed(seed))
    return out


# ---------------------------------------------------------------------------
# Work orders
# ---------------------------------------------------------------------------


@router.get("/workorders")
def list_workorders(
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    if not identity.email:
        raise HTTPException(status_code=400, detail="Token has no email claim")
    work_orders = provider.list_work_orders(identity.email)
    result = []
    for wo in work_orders:
        site = _resolve_site(db, provider, wo["siteId"])
        result.append(
            {
                **wo,
                "site": {
                    "id": wo["siteId"],
                    "customerName": (site or {}).get("customerName", ""),
                    "siteName": (site or {}).get("siteName", ""),
                },
            }
        )
    return {"workOrders": result}


@router.get("/workorders/{work_order_id}")
def get_workorder(
    work_order_id: str,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    wo = provider.get_work_order(work_order_id)
    if wo is None:
        raise HTTPException(status_code=404, detail="Unknown work order")
    if identity.email and wo["assignedTechnicianEmail"].lower() != identity.email.lower():
        raise HTTPException(status_code=403, detail="Work order is not assigned to you")
    return {
        "workOrder": wo,
        "site": _resolve_site(db, provider, wo["siteId"]),
        "dispensers": _resolve_dispensers(db, provider, wo),
    }


# ---------------------------------------------------------------------------
# Sites
# ---------------------------------------------------------------------------


@router.get("/sites")
def list_sites(
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    """Sites across the technician's work orders, resolved against our store."""
    if not identity.email:
        raise HTTPException(status_code=400, detail="Token has no email claim")
    seeds = provider.list_sites_for_technician(identity.email)
    out = [_resolve_site(db, provider, s["id"]) for s in seeds]
    return {"sites": [s for s in out if s]}


@router.get("/sites/{site_id}/dispensers")
def list_site_dispensers(
    site_id: str,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    """Active + retired dispensers at a site (our store wins over the seed)."""
    stored = {
        d.id: d
        for d in db.scalars(select(Dispenser).where(Dispenser.site_id == site_id)).all()
    }
    order: list[str] = [s["id"] for s in provider.list_dispensers(site_id)]
    for did in stored:
        if did not in order:
            order.append(did)

    out: list[dict] = []
    for did in order:
        if did in stored:
            out.append(_dispenser_record(stored[did]))
        else:
            seed = provider.get_dispenser(did)
            if seed:
                out.append(_dispenser_from_seed(seed))
    return {"dispensers": out}


@router.get("/sites/{site_id}")
def get_site(
    site_id: str,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    site = _resolve_site(db, provider, site_id)
    if site is None:
        raise HTTPException(status_code=404, detail="Unknown site")
    return site


@router.post("/sites/{site_id}")
def upsert_site(
    site_id: str,
    payload: dict = Body(...),
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    """Persist the technician's completed/corrected site identity. Seeds from
    OnKey the first time, then becomes our canonical record."""
    for field in ("customerName", "siteName", "address"):
        if not str(payload.get(field, "")).strip():
            raise HTTPException(status_code=422, detail=f"{field} is required")

    site = db.get(Site, site_id)
    seed = provider.get_site(site_id)
    if site is None:
        site = Site(id=site_id, source="onkey" if seed else "manual")
        db.add(site)
    site.customer_name = payload["customerName"]
    site.site_name = payload["siteName"]
    site.address = payload["address"]
    site.telephone = payload.get("telephone")
    site.updated_at = _now()
    db.commit()
    return _site_record(site)


# ---------------------------------------------------------------------------
# Dispensers
# ---------------------------------------------------------------------------


@router.get("/dispensers/{dispenser_id}")
def get_dispenser(
    dispenser_id: str,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    stored = db.get(Dispenser, dispenser_id)
    if stored is not None:
        return _dispenser_record(stored)
    seed = provider.get_dispenser(dispenser_id)
    if seed is None:
        raise HTTPException(status_code=404, detail="Unknown dispenser")
    return _dispenser_from_seed(seed)


def _require_identity_fields(payload: dict) -> None:
    for field in ("make", "model", "serialNumber", "saApprovalNumber"):
        if not str(payload.get(field, "")).strip():
            raise HTTPException(status_code=422, detail=f"{field} is required")


@router.post("/dispensers")
def add_dispenser(
    payload: dict = Body(...),
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> dict:
    """Add a dispenser OnKey doesn't know about (source: manual, active)."""
    site_id = str(payload.get("siteId", "")).strip()
    if not site_id:
        raise HTTPException(status_code=422, detail="siteId is required")
    _require_identity_fields(payload)

    dispenser_id = str(payload.get("id") or "").strip() or f"DISP-M-{_now().strftime('%Y%m%d%H%M%S%f')}"
    if db.get(Dispenser, dispenser_id) is not None:
        raise HTTPException(status_code=409, detail=f"Dispenser {dispenser_id} already exists")

    d = Dispenser(
        id=dispenser_id,
        site_id=site_id,
        make=payload["make"],
        model=payload["model"],
        serial_number=payload["serialNumber"],
        sa_approval_number=payload["saApprovalNumber"],
        status="active",
        source="manual",
        added_by=identity.name,
        added_at=_now(),
        updated_at=_now(),
    )
    db.add(d)
    db.commit()
    return _dispenser_record(d)


@router.post("/dispensers/{dispenser_id}")
def edit_dispenser(
    dispenser_id: str,
    payload: dict = Body(...),
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    """Persist the technician's completed/corrected dispenser identity. Seeds
    from OnKey the first time, then becomes our canonical record."""
    _require_identity_fields(payload)
    d = db.get(Dispenser, dispenser_id)
    seed = provider.get_dispenser(dispenser_id)
    if d is None:
        if seed is None:
            raise HTTPException(status_code=404, detail="Unknown dispenser")
        d = Dispenser(
            id=dispenser_id,
            site_id=seed["siteId"],
            status="active",
            source="onkey",
        )
        db.add(d)
    d.make = payload["make"]
    d.model = payload["model"]
    d.serial_number = payload["serialNumber"]
    d.sa_approval_number = payload["saApprovalNumber"]
    if payload.get("siteId"):
        d.site_id = payload["siteId"]
    d.updated_at = _now()
    db.commit()
    return _dispenser_record(d)


@router.post("/dispensers/{dispenser_id}/retire")
def retire_dispenser(
    dispenser_id: str,
    payload: dict = Body(default={}),
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
    provider: WorkOrderProvider = Depends(get_workorder_provider),
) -> dict:
    """Soft-retire a decommissioned dispenser (never a hard delete). If it only
    existed as a seed, materialise the canonical record first."""
    d = db.get(Dispenser, dispenser_id)
    if d is None:
        seed = provider.get_dispenser(dispenser_id)
        if seed is None:
            raise HTTPException(status_code=404, detail="Unknown dispenser")
        d = Dispenser(
            id=dispenser_id,
            site_id=seed["siteId"],
            make=seed.get("make", ""),
            model=seed.get("model", ""),
            serial_number=seed.get("serialNumber", ""),
            sa_approval_number=seed.get("saApprovalNumber", ""),
            source="onkey",
        )
        db.add(d)
    d.status = "retired"
    d.retired_by = identity.name
    d.retired_at = _now()
    d.updated_at = _now()
    db.commit()
    return _dispenser_record(d)


# ---------------------------------------------------------------------------
# Component register (DispenserDetail)
# ---------------------------------------------------------------------------


def _detail_record(detail: DispenserDetail) -> dict:
    return {
        "dispenserId": detail.dispenser_id,
        "qMinLpm": detail.q_min_lpm,
        "qMaxLpm": detail.q_max_lpm,
        "hoses": detail.hoses or [],
        "updatedAt": detail.updated_at.isoformat() if detail.updated_at else None,
    }


@router.get("/dispensers/{dispenser_id}/detail")
def get_dispenser_detail(
    dispenser_id: str,
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> dict:
    detail = db.get(DispenserDetail, dispenser_id)
    if detail is None:
        # Empty register — the technician enters it and POSTs it back.
        return {"dispenserId": dispenser_id, "qMinLpm": None, "qMaxLpm": None, "hoses": []}
    return _detail_record(detail)


@router.post("/dispensers/{dispenser_id}/detail")
def upsert_dispenser_detail(
    dispenser_id: str,
    payload: dict = Body(...),
    identity: Identity = Depends(get_identity),
    db: Session = Depends(get_db),
) -> dict:
    """Save the per-dispenser component register; prefilled next verification."""
    hoses = payload.get("hoses", [])
    if not isinstance(hoses, list):
        raise HTTPException(status_code=422, detail="hoses must be a list")

    detail = db.get(DispenserDetail, dispenser_id)
    if detail is None:
        detail = DispenserDetail(dispenser_id=dispenser_id)
        db.add(detail)
    detail.q_min_lpm = payload.get("qMinLpm")
    detail.q_max_lpm = payload.get("qMaxLpm")
    detail.hoses = hoses
    detail.updated_at = _now()
    db.commit()
    return _detail_record(detail)
