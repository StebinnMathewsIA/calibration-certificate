import base64
import binascii
import hashlib

from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import audit
from ..auth import Identity, get_identity
from ..config import Settings, get_settings
from ..db import get_db
from ..models import Certificate, SequenceCounter
from ..pdf_store import PdfStore, get_pdf_store
from ..readiness import validate_ready_to_sign
from ..schema_validation import validate_sign_submission
from ..signing.crosscheck import crosscheck_pdf
from ..signing.keys import provider_from_settings
from ..signing.service import SigningService

router = APIRouter(prefix="/v1/certificates", tags=["certificates"])


def get_signing_service(settings: Settings = Depends(get_settings)) -> SigningService:
    return SigningService(provider_from_settings(settings), tsa_url=settings.tsa_url)


def _response_for(cert: Certificate, store: PdfStore) -> dict:
    return {
        "certificateNumber": cert.certificate_number,
        "status": "issued",
        "signedPdfBase64": base64.b64encode(store.get(cert.storage_ref)).decode(),
        "signedPdfSha256": cert.signed_pdf_sha256,
        "signatureId": cert.signature_id,
        "signedAt": cert.signed_at.isoformat(),
        "auditId": cert.id,
    }


@router.post("/reserve-number")
def reserve_number(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    """Allocates the next certificate number for a branch (PWC-{branch}-{seq}-{rev}).

    The app reserves a number when a draft is created while online. Offline
    number reservation (pre-allocated blocks per device) is a post-PoC item.
    """
    branch = str(payload.get("branch", "")).upper()
    if not branch.isalpha() or not (2 <= len(branch) <= 5):
        raise HTTPException(status_code=422, detail="branch must be 2-5 letters")

    counter = db.get(SequenceCounter, branch, with_for_update=True)
    if counter is None:
        counter = SequenceCounter(branch=branch, next_value=1)
        db.add(counter)
        db.flush()
    seq = counter.next_value
    counter.next_value = seq + 1
    db.commit()
    return {"certificateNumber": f"PWC-{branch}-{seq:06d}-00"}


@router.post("/sign")
def sign_certificate(
    submission: dict = Body(...),
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
    settings: Settings = Depends(get_settings),
    signing_service: SigningService = Depends(get_signing_service),
    pdf_store: PdfStore = Depends(get_pdf_store),
) -> dict:
    # 1. Structural validation against the shared (zod-derived) JSON Schema
    violations = validate_sign_submission(submission)
    if violations:
        raise HTTPException(status_code=422, detail={"violations": violations})

    verification = submission["verification"]
    cert_number = verification["certificateNumber"]
    idempotency_key = submission["idempotencyKey"]

    # 2. Idempotent replay: same idempotency key => return the stored result.
    #    Retries after connectivity loss never double-sign or double-issue.
    existing = db.scalar(select(Certificate).where(Certificate.idempotency_key == idempotency_key))
    if existing is not None:
        return _response_for(existing, pdf_store)

    # 3. The certificate number itself must also be unique.
    clash = db.scalar(select(Certificate).where(Certificate.certificate_number == cert_number))
    if clash is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Certificate {cert_number} has already been issued",
        )

    # 4. The signed-in identity must be the VO (technician) on the verification.
    if verification["signOff"]["vo"]["identity"]["subject"] != identity.subject:
        raise HTTPException(status_code=403, detail="Token subject does not match signing VO")

    # 5. Cross-field readiness checks (measures in date, recomputed EFD, ...)
    reasons = validate_ready_to_sign(verification)
    if reasons:
        audit.record(db, cert_number, audit.CERT_SIGN_REJECTED, identity.subject, {"reasons": reasons})
        db.commit()
        raise HTTPException(status_code=422, detail={"violations": reasons})

    # 6. PDF integrity: the uploaded bytes must hash to the client-stated digest.
    try:
        pdf_bytes = base64.b64decode(submission["pdfBase64"], validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="pdfBase64 is not valid base64") from exc
    actual_sha = hashlib.sha256(pdf_bytes).hexdigest()
    if actual_sha != submission["pdfSha256"]:
        raise HTTPException(status_code=400, detail="pdfSha256 does not match uploaded PDF bytes")

    # 7. Cross-check the PDF text layer against the verification JSON — a
    #    compromised client cannot get arbitrary content signed.
    mismatches = crosscheck_pdf(pdf_bytes, verification)
    if mismatches:
        audit.record(
            db, cert_number, audit.CERT_SIGN_REJECTED, identity.subject, {"reasons": mismatches}
        )
        db.commit()
        raise HTTPException(status_code=422, detail={"violations": mismatches})

    # 8. Sign. Audit records BOTH the technician's intent-to-sign time (device
    #    clock, possibly offline) and the cryptographic signing time.
    audit.record(
        db,
        cert_number,
        audit.CERT_SIGN_REQUESTED,
        identity.subject,
        {
            "idempotencyKey": idempotency_key,
            "intentToSign": submission["intentToSign"],
            "unsignedPdfSha256": submission["pdfSha256"],
            "authMethod": verification["signOff"]["vo"]["identity"]["authMethod"],
        },
    )
    result = signing_service.sign_certificate_pdf(
        pdf_bytes,
        technician_name=verification["signOff"]["vo"]["identity"]["name"],
        certificate_number=cert_number,
    )

    # Persist the signed PDF to the Supabase Storage bucket BEFORE the
    # certificate row is committed so a storage failure can never yield an
    # issued-but-unretrievable certificate.
    storage_ref = pdf_store.put(cert_number, result.signed_pdf)

    cert = Certificate(
        certificate_number=cert_number,
        idempotency_key=idempotency_key,
        technician_subject=verification["signOff"]["vo"]["identity"]["subject"],
        form_json=verification,
        unsigned_pdf_sha256=submission["pdfSha256"],
        signed_pdf_sha256=result.signed_pdf_sha256,
        storage_ref=storage_ref,
        signature_id=result.signature_id,
        signed_at=result.signed_at,
    )
    db.add(cert)
    db.flush()
    audit.record(
        db,
        cert_number,
        audit.CERT_ISSUED,
        identity.subject,
        {
            "signedPdfSha256": result.signed_pdf_sha256,
            "signatureId": result.signature_id,
            "signedAt": result.signed_at.isoformat(),
        },
    )
    db.commit()
    return _response_for(cert, pdf_store)


@router.get("/{certificate_number}/receipt")
def get_receipt(
    certificate_number: str,
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
) -> dict:
    """Confirms the server-side audit record exists — the app calls this to
    move a certificate from SIGNED to SYNCED."""
    cert = db.scalar(
        select(Certificate).where(Certificate.certificate_number == certificate_number)
    )
    if cert is None:
        raise HTTPException(status_code=404, detail="Unknown certificate")
    audit.record(db, certificate_number, audit.CERT_SYNC_CONFIRMED, identity.subject, {})
    db.commit()
    return {
        "certificateNumber": cert.certificate_number,
        "status": cert.status,
        "signedPdfSha256": cert.signed_pdf_sha256,
        "signedAt": cert.signed_at.isoformat(),
        "auditId": cert.id,
    }
