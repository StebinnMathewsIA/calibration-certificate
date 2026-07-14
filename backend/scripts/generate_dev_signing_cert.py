#!/usr/bin/env python3
"""Generates DEV-ONLY signing material: a self-signed certificate + RSA key.

Output goes to backend/dev-keys/ (gitignored). Production keys live in cloud
KMS/HSM and never exist as files — see app/signing/keys.py and
docs/key-rotation-runbook.md.
"""
import argparse
import datetime
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def generate(out_dir: Path, common_name: str = "Prowalco DEV Signing (NOT FOR PRODUCTION)") -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)

    subject = issuer = x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "ZA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Prowalco (Pty) Ltd"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ]
    )
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=365))
        .add_extension(
            x509.KeyUsage(
                digital_signature=True,
                content_commitment=True,  # non-repudiation
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=False,
                crl_sign=False,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )

    (out_dir / "signing-key.pem").write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    (out_dir / "signing-cert.pem").write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Wrote dev signing key + cert to {out_dir}/")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "dev-keys"),
        help="Output directory (default: backend/dev-keys)",
    )
    args = parser.parse_args()
    generate(Path(args.out))
