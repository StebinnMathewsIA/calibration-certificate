import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, DateTime, Float, String, Text
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


# ---------------------------------------------------------------------------
# Canonical store (migrations/002_workorders.sql) — the INTERNAL records we
# own and persist. MUTABLE: identity is corrected over time. Issued
# verifications snapshot identity at signing, so edits never rewrite history.
# ---------------------------------------------------------------------------


class Site(Base):
    """Our canonical copy of a site's identity, seeded from OnKey when present
    and completed by the technician when not."""

    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    customer_name: Mapped[str] = mapped_column(String(200))
    site_name: Mapped[str] = mapped_column(String(200))
    address: Mapped[str] = mapped_column(String(500))
    telephone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # 'onkey' | 'manual'
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Dispenser(Base):
    """Our canonical copy of a dispenser's identity + lifecycle. Retire is a
    soft status change (never a hard delete) so issued verifications and the
    audit history are preserved."""

    __tablename__ = "dispensers"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    site_id: Mapped[str] = mapped_column(String(64), index=True)
    make: Mapped[str] = mapped_column(String(100))
    model: Mapped[str] = mapped_column(String(100))
    serial_number: Mapped[str] = mapped_column(String(100))
    sa_approval_number: Mapped[str] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(16), default="active")  # 'active' | 'retired'
    source: Mapped[str] = mapped_column(String(16))  # 'onkey' | 'manual'
    added_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    added_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    retired_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class DispenserDetail(Base):
    """The per-dispenser component register OnKey has no concept of: the hoses
    and their meter/PC board/pulsar/solenoid components, plus data-plate flow
    range. Entered once, prefilled next verification."""

    __tablename__ = "dispenser_details"

    dispenser_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    q_min_lpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    q_max_lpm: Mapped[float | None] = mapped_column(Float, nullable=True)
    hoses: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


class Device(Base):
    """Device-binding enrollment register (#51). One row per (device, account)
    pair; the public key lets the signing endpoint cryptographically verify
    which physical device submitted a certificate package."""

    __tablename__ = "devices"

    device_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    subject: Mapped[str] = mapped_column(String(200), primary_key=True)
    public_key_pem: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active")  # 'active'|'pending'|'revoked'
    platform: Mapped[str | None] = mapped_column(String(32), nullable=True)
    model: Mapped[str | None] = mapped_column(String(128), nullable=True)
    technician_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    approved_by: Mapped[str | None] = mapped_column(String(200), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
