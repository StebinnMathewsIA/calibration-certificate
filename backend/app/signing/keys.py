"""Signing key providers.

Production keys live in cloud KMS/HSM and are NEVER on a device or in the
repo: `AwsKmsKeyProvider` holds only a key ID — the private key is generated
inside AWS KMS, is non-exportable, and every kms:Sign call is logged in
CloudTrail independently of our audit table. The PoC providers (local PEM /
env PEM, self-signed dev CA via scripts/generate_dev_signing_cert.py) remain
for development. Rotation policy: docs/key-rotation-runbook.md.
"""
import asyncio
import base64
import binascii
import hashlib
import logging
from pathlib import Path
from typing import Protocol

from pyhanko.keys import load_certs_from_pemder_data
from pyhanko.sign import signers
from pyhanko_certvalidator.registry import SimpleCertificateStore

logger = logging.getLogger("prowalco.signing")


class SigningKeyProvider(Protocol):
    def get_signer(self) -> signers.Signer: ...


class LocalPemKeyProvider:
    """Dev/test: key + cert PEM files on local disk. With auto_generate=True
    (diskless PoC hosts) a self-signed dev key is created at first use —
    ephemeral across restarts, loudly logged."""

    def __init__(self, key_dir: str, auto_generate: bool = False):
        self.key_dir = Path(key_dir)
        self.auto_generate = auto_generate

    def get_signer(self) -> signers.SimpleSigner:
        key = self.key_dir / "signing-key.pem"
        cert = self.key_dir / "signing-cert.pem"
        if not key.exists() or not cert.exists():
            if not self.auto_generate:
                raise FileNotFoundError(
                    f"Dev signing material not found in {self.key_dir}. "
                    "Run: python scripts/generate_dev_signing_cert.py"
                )
            logger.warning(
                "SIGNING WITH AN EPHEMERAL DEV KEY (auto-generated at boot, "
                "changes on every restart). PoC only — provide "
                "SIGNING_KEY_PEM_B64/SIGNING_CERT_PEM_B64 or move to KMS "
                "before relying on issued certificates."
            )
            # Imported lazily and path-safely (the scripts/ package is not on
            # sys.path under uvicorn).
            import sys

            backend_dir = str(Path(__file__).resolve().parents[2])
            if backend_dir not in sys.path:
                sys.path.insert(0, backend_dir)
            from scripts.generate_dev_signing_cert import generate

            generate(self.key_dir)
        signer = signers.SimpleSigner.load(str(key), str(cert), key_passphrase=None)
        if signer is None:
            raise ValueError(f"Failed to load signing material from {self.key_dir}")
        return signer


class EnvPemKeyProvider:
    """Key material supplied as base64-encoded PEM env vars — for diskless
    hosts (Render). Decoded to a private tmp dir once and reused."""

    def __init__(self, key_pem_b64: str, cert_pem_b64: str):
        try:
            self._key_pem = base64.b64decode(key_pem_b64, validate=True)
            self._cert_pem = base64.b64decode(cert_pem_b64, validate=True)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("SIGNING_*_PEM_B64 values are not valid base64") from exc
        self._materialized: Path | None = None

    def get_signer(self) -> signers.SimpleSigner:
        if self._materialized is None:
            import tempfile

            d = Path(tempfile.mkdtemp(prefix="signing-"))
            (d / "signing-key.pem").write_bytes(self._key_pem)
            (d / "signing-cert.pem").write_bytes(self._cert_pem)
            self._materialized = d
        signer = signers.SimpleSigner.load(
            str(self._materialized / "signing-key.pem"),
            str(self._materialized / "signing-cert.pem"),
            key_passphrase=None,
        )
        if signer is None:
            raise ValueError("Failed to load signing material from env")
        return signer


# pyHanko digest algorithm name -> AWS KMS SigningAlgorithm (RSA keys).
_KMS_SIGNING_ALGORITHMS = {
    "sha256": "RSASSA_PKCS1_V1_5_SHA_256",
    "sha384": "RSASSA_PKCS1_V1_5_SHA_384",
    "sha512": "RSASSA_PKCS1_V1_5_SHA_512",
}


class KmsSigner(signers.Signer):
    """pyHanko Signer whose raw signature operation happens inside AWS KMS.

    Only the document digest leaves this process — the private key is
    non-exportable in KMS. The signing certificate (public) is issued for the
    KMS public key by scripts/issue_cert_for_kms_key.py.
    """

    def __init__(self, kms_client, key_id: str, cert_pem: bytes, chain_pem: bytes = b""):
        certs = list(load_certs_from_pemder_data(cert_pem))
        if not certs:
            raise ValueError("SIGNING_CERT_PEM_B64 contains no certificate")
        chain = list(load_certs_from_pemder_data(chain_pem)) if chain_pem else []
        super().__init__(
            signing_cert=certs[0],
            cert_registry=SimpleCertificateStore.from_certs(certs + chain),
        )
        self._kms = kms_client
        self._key_id = key_id
        # RSA signature length == modulus size in bytes (for dry-run sizing).
        self._sig_bytes = (certs[0].public_key.bit_size + 7) // 8

    async def async_sign_raw(self, data: bytes, digest_algorithm: str, dry_run: bool = False) -> bytes:
        if dry_run:
            return bytes(self._sig_bytes)
        algo = _KMS_SIGNING_ALGORITHMS.get(digest_algorithm.lower())
        if algo is None:
            raise ValueError(f"Unsupported digest for KMS signing: {digest_algorithm}")
        digest = hashlib.new(digest_algorithm, data).digest()
        # boto3 is synchronous; keep the event loop free.
        response = await asyncio.to_thread(
            self._kms.sign,
            KeyId=self._key_id,
            Message=digest,
            MessageType="DIGEST",
            SigningAlgorithm=algo,
        )
        return response["Signature"]


class AwsKmsKeyProvider:
    """Production path: asymmetric signing key held in AWS KMS.

    - the private key never exists outside KMS; we call kms:Sign with the
      document digest (MessageType='DIGEST');
    - the certificate chain (internal CA for v1) is public material supplied
      via env vars or signing_key_dir;
    - IAM policy restricts kms:Sign / kms:GetPublicKey to the signing
      service's credentials (see docs/key-rotation-runbook.md).
    """

    def __init__(
        self,
        key_id: str,
        region: str,
        cert_pem: bytes,
        chain_pem: bytes = b"",
        kms_client=None,
    ):
        if not key_id:
            raise ValueError("AWS_KMS_KEY_ID must be set for the aws_kms signing provider")
        if not cert_pem:
            raise ValueError(
                "aws_kms provider needs the signing certificate: set "
                "SIGNING_CERT_PEM_B64 (see scripts/issue_cert_for_kms_key.py) "
                "or place kms-signing-cert.pem in SIGNING_KEY_DIR"
            )
        if kms_client is None:
            import boto3  # lazy: only required when this provider is selected

            kms_client = boto3.client("kms", region_name=region or None)
        self._signer = KmsSigner(kms_client, key_id, cert_pem, chain_pem)

    def get_signer(self) -> signers.Signer:
        return self._signer


def _read_optional(path: Path) -> bytes:
    return path.read_bytes() if path.exists() else b""


def provider_from_settings(settings) -> SigningKeyProvider:
    if settings.signing_key_provider == "aws_kms":
        # Cert material: env vars win; falls back to files in signing_key_dir.
        key_dir = Path(settings.signing_key_dir)
        cert_pem = (
            base64.b64decode(settings.signing_cert_pem_b64)
            if settings.signing_cert_pem_b64
            else _read_optional(key_dir / "kms-signing-cert.pem")
        )
        chain_pem = (
            base64.b64decode(settings.signing_cert_chain_pem_b64)
            if settings.signing_cert_chain_pem_b64
            else _read_optional(key_dir / "kms-signing-chain.pem")
        )
        return AwsKmsKeyProvider(
            key_id=settings.aws_kms_key_id,
            region=settings.aws_region,
            cert_pem=cert_pem,
            chain_pem=chain_pem,
        )
    # Explicit key material via env vars wins (diskless hosts).
    if settings.signing_key_pem_b64 and settings.signing_cert_pem_b64:
        return EnvPemKeyProvider(settings.signing_key_pem_b64, settings.signing_cert_pem_b64)
    if settings.signing_key_provider == "local":
        return LocalPemKeyProvider(
            settings.signing_key_dir, auto_generate=settings.signing_autogenerate_dev_key
        )
    raise ValueError(f"Unknown signing key provider: {settings.signing_key_provider}")
