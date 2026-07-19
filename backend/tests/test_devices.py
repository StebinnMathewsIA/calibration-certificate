"""Device binding (#51): TOFU policy + signature verification (pure units)."""
import base64
import time

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.devices import (
    check_device_binding,
    device_signature_message,
    resolve_enrollment_status,
    verify_device_signature,
)


def _keypair():
    key = ec.generate_private_key(ec.SECP256R1())
    pub_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return key, pub_pem


def _sign(key, message: str) -> str:
    return base64.b64encode(key.sign(message.encode(), ec.ECDSA(hashes.SHA256()))).decode()


def test_tofu_policy():
    assert resolve_enrollment_status([]) == "active"  # fresh device claimed
    assert resolve_enrollment_status(["pending"]) == "active"
    assert resolve_enrollment_status(["active"]) == "pending"  # owned -> approval
    assert resolve_enrollment_status(["revoked"]) == "active"


def test_signature_round_trip():
    key, pub = _keypair()
    ts = str(int(time.time()))
    msg = device_signature_message("dev-1", ts, "abc123")
    sig = _sign(key, msg)
    assert verify_device_signature(pub, msg, sig)
    assert not verify_device_signature(pub, msg + "x", sig)
    assert not verify_device_signature("not a pem", msg, sig)
    assert not verify_device_signature(pub, msg, "!!notb64!!")


def test_check_device_binding():
    key, pub = _keypair()
    ts = str(int(time.time()))
    sig = _sign(key, device_signature_message("dev-1", ts, "abc123"))
    assert check_device_binding(pub, "dev-1", ts, sig, "abc123").result == "verified"
    assert check_device_binding(pub, "dev-1", ts, sig, "TAMPERED").result == "failed"
    assert check_device_binding(None, "dev-1", ts, sig, "abc123").result == "failed"
    assert check_device_binding(pub, None, None, None, "abc123").result == "absent"

    stale = str(int(time.time()) - 4000)
    stale_sig = _sign(key, device_signature_message("dev-1", stale, "abc123"))
    assert check_device_binding(pub, "dev-1", stale, stale_sig, "abc123").result == "failed"
