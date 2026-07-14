"""Append-only audit trail helpers.

Rules (see docs/e-signature-procedure.md):
- events are inserted, never updated or deleted (enforced at DB level in
  Postgres via migrations/001_init.sql);
- amendments to a signed certificate create a NEW certificate number that
  supersedes the old one — the old record is never mutated.
"""
from sqlalchemy.orm import Session

from .models import AuditEvent

# Event types
CERT_SIGN_REQUESTED = "certificate.sign_requested"
CERT_ISSUED = "certificate.issued"
CERT_SIGN_REJECTED = "certificate.sign_rejected"
CERT_SYNC_CONFIRMED = "certificate.sync_confirmed"
ANALYSIS_COMPLETED = "analysis.completed"
MANAGER_NOTIFIED = "analysis.manager_notified"


def record(
    db: Session,
    certificate_number: str,
    event_type: str,
    actor_subject: str,
    payload: dict,
) -> AuditEvent:
    event = AuditEvent(
        certificate_number=certificate_number,
        event_type=event_type,
        actor_subject=actor_subject,
        payload=payload,
    )
    db.add(event)
    db.flush()  # assign id without committing — caller owns the transaction
    return event
