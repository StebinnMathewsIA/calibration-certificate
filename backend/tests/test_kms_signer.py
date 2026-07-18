"""KMS signing parity test.

Runs the FULL production code path — issue_cert_for_kms_key.issue() for the
certificate, KmsSigner via AwsKmsKeyProvider, SigningService.sign_certificate_pdf
— against a fake KMS client backed by a local RSA key, then validates the
produced PAdES signature chains to the internal CA. The only thing the fake
replaces is the AWS network call, so a green run means the real provider only
needs credentials.
"""
import io
from pathlib import Path

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.asymmetric.utils import Prehashed
from pyhanko.keys import load_cert_from_pemder
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

from app.signing.keys import AwsKmsKeyProvider
from app.signing.service import SigningService
from scripts.issue_cert_for_kms_key import issue
from tests.conftest import build_certificate_pdf, make_valid_verification

_KMS_HASHES = {
    "RSASSA_PKCS1_V1_5_SHA_256": hashes.SHA256,
    "RSASSA_PKCS1_V1_5_SHA_384": hashes.SHA384,
    "RSASSA_PKCS1_V1_5_SHA_512": hashes.SHA512,
}


class FakeKms:
    """Stands in for boto3's KMS client: same request/response shapes, but the
    'non-exportable' key is a local RSA key so the test needs no AWS."""

    def __init__(self):
        self._key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def get_public_key(self, KeyId: str):
        return {
            "PublicKey": self._key.public_key().public_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PublicFormat.SubjectPublicKeyInfo,
            )
        }

    def sign(self, KeyId: str, Message: bytes, MessageType: str, SigningAlgorithm: str):
        assert MessageType == "DIGEST"
        hash_cls = _KMS_HASHES[SigningAlgorithm]
        # Prehashed: Message is the digest, exactly as KMS receives it.
        signature = self._key.sign(Message, padding.PKCS1v15(), Prehashed(hash_cls()))
        return {"Signature": signature}


@pytest.fixture
def kms_setup(tmp_path: Path):
    fake = FakeKms()
    issue(key_id="alias/test", region="", out_dir=tmp_path, validity_days=30, kms_client=fake)
    provider = AwsKmsKeyProvider(
        key_id="alias/test",
        region="",
        cert_pem=(tmp_path / "kms-signing-cert.pem").read_bytes(),
        chain_pem=(tmp_path / "kms-signing-chain.pem").read_bytes(),
        kms_client=fake,
    )
    return provider, tmp_path


def test_kms_signed_pdf_validates_against_internal_ca(kms_setup):
    provider, key_dir = kms_setup
    verification = make_valid_verification(cert_number="PWC-JHB-000042-00")
    pdf = build_certificate_pdf(verification)

    service = SigningService(key_provider=provider)
    result = service.sign_certificate_pdf(
        pdf_bytes=pdf,
        technician_name="S. Mathews",
        certificate_number="PWC-JHB-000042-00",
    )

    ca_cert = load_cert_from_pemder(str(key_dir / "ca-cert.pem"))
    vc = ValidationContext(trust_roots=[ca_cert], allow_fetching=False)
    reader = PdfFileReader(io.BytesIO(result.signed_pdf))
    sigs = reader.embedded_signatures
    assert len(sigs) == 1
    status = validate_pdf_signature(sigs[0], vc)
    assert status.intact
    assert status.valid


def test_misconfigured_kms_provider_fails_loudly():
    with pytest.raises(ValueError, match="AWS_KMS_KEY_ID"):
        AwsKmsKeyProvider(key_id="", region="", cert_pem=b"x")
    with pytest.raises(ValueError, match="signing certificate"):
        AwsKmsKeyProvider(key_id="alias/test", region="", cert_pem=b"")
