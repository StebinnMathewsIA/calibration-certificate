"""Device binding (#51): trust-on-first-use enrollment policy + request
signature verification.

The tablet holds an EC P-256 keypair (private key in the app's secure store,
never transmitted); enrollment registers the public key against the signed-in
account. Certificate uploads carry `X-Device-Id` / `X-Device-Timestamp` /
`X-Device-Signature` where the signature is ECDSA-SHA256 over
``deviceId.timestamp.pdfSha256`` — proof the upload came from that physical
device. Enforcement is flag-gated (settings.device_binding_enforce).
"""
import base64
import binascii
import time
from dataclasses import dataclass

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec, padding, rsa
from cryptography.hazmat.primitives.serialization import load_pem_public_key

# Signing happens at upload time (online), so skew only needs to absorb bad
# device clocks — not offline queuing.
MAX_TIMESTAMP_SKEW_SECONDS = 600

STATUS_ACTIVE = "active"
STATUS_PENDING = "pending"
STATUS_REVOKED = "revoked"


def resolve_enrollment_status(existing_statuses_by_other_subjects: list[str]) -> str:
    """TOFU policy for a subject enrolling a device they have no row on yet:
    a fresh device (no other ACTIVE owner) is claimed immediately; a device
    someone else actively owns needs admin approval."""
    if STATUS_ACTIVE in existing_statuses_by_other_subjects:
        return STATUS_PENDING
    return STATUS_ACTIVE


def device_signature_message(device_id: str, timestamp: str, pdf_sha256: str) -> str:
    return f"{device_id}.{timestamp}.{pdf_sha256}"


def verify_device_signature(public_key_pem: str, message: str, signature_b64: str) -> bool:
    """True iff signature_b64 is a valid signature over message by the
    enrolled key. EC P-256 is what the app generates; RSA accepted for
    forward-compatibility."""
    try:
        key = load_pem_public_key(public_key_pem.encode())
        signature = base64.b64decode(signature_b64, validate=True)
    except (ValueError, binascii.Error):
        return False
    try:
        if isinstance(key, ec.EllipticCurvePublicKey):
            key.verify(signature, message.encode(), ec.ECDSA(hashes.SHA256()))
        elif isinstance(key, rsa.RSAPublicKey):
            key.verify(signature, message.encode(), padding.PKCS1v15(), hashes.SHA256())
        else:
            return False
        return True
    except InvalidSignature:
        return False


@dataclass(frozen=True)
class DeviceCheck:
    """Outcome of the device-binding check on a signing request."""

    result: str  # 'verified' | 'absent' | 'failed'
    reason: str | None = None
    device_id: str | None = None


def check_device_binding(
    enrolled_public_key_pem: str | None,
    device_id: str | None,
    timestamp: str | None,
    signature_b64: str | None,
    pdf_sha256: str,
    now: float | None = None,
) -> DeviceCheck:
    """Pure check: caller supplies the ACTIVE enrolled key for
    (device_id, subject), or None if there is no active enrollment."""
    if not device_id or not timestamp or not signature_b64:
        return DeviceCheck("absent", "device headers missing", device_id)
    if enrolled_public_key_pem is None:
        return DeviceCheck("failed", "device is not enrolled and active for this account", device_id)
    try:
        ts = int(timestamp)
    except ValueError:
        return DeviceCheck("failed", "device timestamp is not an integer", device_id)
    if abs((now if now is not None else time.time()) - ts) > MAX_TIMESTAMP_SKEW_SECONDS:
        return DeviceCheck("failed", "device timestamp outside the allowed window", device_id)
    message = device_signature_message(device_id, timestamp, pdf_sha256)
    if not verify_device_signature(enrolled_public_key_pem, message, signature_b64):
        return DeviceCheck("failed", "device signature invalid", device_id)
    return DeviceCheck("verified", None, device_id)
