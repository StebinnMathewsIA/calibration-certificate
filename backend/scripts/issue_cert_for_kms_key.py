#!/usr/bin/env python3
"""Issues the signing CERTIFICATE for a private key held in AWS KMS.

The private key never leaves KMS — this script only fetches its PUBLIC key
(kms:GetPublicKey), then issues an X.509 signing certificate for it from the
Prowalco internal CA (v1 trust model; see CLAUDE.md). The CA key pair is
created on first run and must be kept offline/safe — it is only ever needed
again at rotation time.

Outputs (in --out, default backend/dev-keys/):
  ca-key.pem / ca-cert.pem        internal CA (created once; keep ca-key safe)
  kms-signing-cert.pem            certificate for the KMS key
  kms-signing-chain.pem           the CA certificate (chain)

and prints the base64 values for the Render/hosting env vars:
  SIGNING_CERT_PEM_B64, SIGNING_CERT_CHAIN_PEM_B64

Usage:
  python scripts/issue_cert_for_kms_key.py --key-id alias/prowalco-signing --region af-south-1
"""
import argparse
import base64
import datetime
from pathlib import Path

import boto3
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def _name(common_name: str) -> x509.Name:
    return x509.Name(
        [
            x509.NameAttribute(NameOID.COUNTRY_NAME, "ZA"),
            x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Prowalco (Pty) Ltd"),
            x509.NameAttribute(NameOID.COMMON_NAME, common_name),
        ]
    )


def ensure_ca(out_dir: Path) -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    """Loads the internal CA, creating it on first run (10-year validity)."""
    key_path = out_dir / "ca-key.pem"
    cert_path = out_dir / "ca-cert.pem"
    if key_path.exists() and cert_path.exists():
        key = serialization.load_pem_private_key(key_path.read_bytes(), password=None)
        cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
        return key, cert  # type: ignore[return-value]

    key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
    now = datetime.datetime.now(datetime.timezone.utc)
    subject = _name("Prowalco Internal Signing CA v1")
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(subject)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=False,
                content_commitment=False,
                key_encipherment=False,
                data_encipherment=False,
                key_agreement=False,
                key_cert_sign=True,
                crl_sign=True,
                encipher_only=False,
                decipher_only=False,
            ),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Created internal CA in {out_dir}/ — keep ca-key.pem OFFLINE and safe.")
    return key, cert


def issue(key_id: str, region: str, out_dir: Path, validity_days: int, kms_client=None) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    kms = kms_client or boto3.client("kms", region_name=region or None)
    spki_der = kms.get_public_key(KeyId=key_id)["PublicKey"]
    kms_public_key = serialization.load_der_public_key(spki_der)

    ca_key, ca_cert = ensure_ca(out_dir)
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(_name("Prowalco Certificate Signing"))
        .issuer_name(ca_cert.subject)
        .public_key(kms_public_key)
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(minutes=5))
        .not_valid_after(now + datetime.timedelta(days=validity_days))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
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
        .add_extension(
            # Adobe "PDF signing" extended key usage.
            x509.ExtendedKeyUsage([x509.ObjectIdentifier("1.2.840.113583.1.1.5")]),
            critical=False,
        )
        .sign(ca_key, hashes.SHA256())
    )

    cert_pem = cert.public_bytes(serialization.Encoding.PEM)
    chain_pem = ca_cert.public_bytes(serialization.Encoding.PEM)
    (out_dir / "kms-signing-cert.pem").write_bytes(cert_pem)
    (out_dir / "kms-signing-chain.pem").write_bytes(chain_pem)
    print(f"Issued kms-signing-cert.pem (valid {validity_days} days) in {out_dir}/")
    print("\nEnvironment for the signing service (e.g. Render):")
    print(f"  SIGNING_KEY_PROVIDER=aws_kms")
    print(f"  AWS_KMS_KEY_ID={key_id}")
    print(f"  AWS_REGION={region}")
    print(f"  SIGNING_CERT_PEM_B64={base64.b64encode(cert_pem).decode()}")
    print(f"  SIGNING_CERT_CHAIN_PEM_B64={base64.b64encode(chain_pem).decode()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key-id", required=True, help="KMS key ID, ARN or alias/<name>")
    parser.add_argument("--region", default="", help="AWS region (default: SDK default chain)")
    parser.add_argument(
        "--out",
        default=str(Path(__file__).resolve().parent.parent / "dev-keys"),
        help="Output directory (default: backend/dev-keys)",
    )
    parser.add_argument("--validity-days", type=int, default=1095, help="Cert validity (default 3y)")
    args = parser.parse_args()
    issue(args.key_id, args.region, Path(args.out), args.validity_days)
