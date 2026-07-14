import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Certificate(Base):
    """Issued (signed) certificates. Never mutated after issue — amendments
    create a NEW certificate number superseding the old one."""

    __tablename__ = "certificates"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    certificate_number: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    # Client-generated idempotency UUID: retries never double-sign/double-issue.
    idempotency_key: Mapped[str] = mapped_column(String(36), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(16), default="issued")
    technician_subject: Mapped[str] = mapped_column(String(200))
    form_json: Mapped[dict] = mapped_column(JSON)
    unsigned_pdf_sha256: Mapped[str] = mapped_column(String(64))
    signed_pdf_sha256: Mapped[str] = mapped_column(String(64))
    # The signed PDF lives in the private Supabase Storage bucket;
    # storage_ref is the object path (app/pdf_store.py).
    storage_ref: Mapped[str] = mapped_column(String(255))
    signature_id: Mapped[str] = mapped_column(String(64))
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    supersedes: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class AuditEvent(Base):
    """Append-only audit trail. This model has no update path in code; the
    Postgres migration additionally revokes UPDATE/DELETE from the app role
    (migrations/001_init.sql)."""

    __tablename__ = "audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    certificate_number: Mapped[str] = mapped_column(String(64), index=True)
    event_type: Mapped[str] = mapped_column(String(64))
    actor_subject: Mapped[str] = mapped_column(String(200))
    payload: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class SequenceCounter(Base):
    """Per-branch certificate number sequence (PWC-{branch}-{seq}-{rev})."""

    __tablename__ = "sequence_counters"

    branch: Mapped[str] = mapped_column(String(8), primary_key=True)
    next_value: Mapped[int] = mapped_column(default=1)
