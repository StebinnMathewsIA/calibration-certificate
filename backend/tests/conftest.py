"""Test fixtures — PRODUCTION PARITY, no separate test architecture.

The suite runs against the real Supabase project configured in backend/.env:
Supabase Postgres (schema auto-applied, idempotent), the private Storage
bucket, and Supabase Auth (a technician test user is provisioned through the
Auth admin API and signed in for a real JWT). If Supabase is not configured,
the suite refuses to run.
"""
import base64
import hashlib
import io
import os
import sys
import tempfile
import uuid
from pathlib import Path

import httpx
import pytest

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

# Signing keys: still the local dev provider until KMS is provisioned —
# generated per test run, never committed.
_KEYS = Path(tempfile.mkdtemp(prefix="prowalco-signing-")) / "dev-keys"
os.environ["SIGNING_KEY_DIR"] = str(_KEYS)
os.environ.setdefault("TSA_URL", "")

from app.config import get_settings, validate_settings  # noqa: E402

_settings = get_settings()
_problems = validate_settings(_settings)
if _problems:
    pytest.exit(
        "Tests run against the real Supabase project and need backend/.env configured "
        "(see docs/supabase-setup.md). Missing:\n- " + "\n- ".join(_problems),
        returncode=1,
    )

# ---------------------------------------------------------------------------
# Apply the schema + ensure the bucket (idempotent), then provision the
# technician test user and sign in for a real Supabase JWT.
# ---------------------------------------------------------------------------
from sqlalchemy import create_engine  # noqa: E402

from app.config import MIGRATIONS_DIR  # noqa: E402
from app.pdf_store import SupabaseStoragePdfStore  # noqa: E402

_engine = create_engine(_settings.database_url)
for _path in sorted(MIGRATIONS_DIR.glob("*.sql")):
    # Raw DBAPI cursor with parameters=None: the SQL contains literal '%'
    # (trigger error message), which psycopg2 would otherwise treat as a
    # format placeholder.
    _raw = _engine.raw_connection()
    try:
        _raw.cursor().execute(_path.read_text())
        _raw.commit()
    finally:
        _raw.close()

pdf_bucket_store = SupabaseStoragePdfStore(
    _settings.supabase_url,
    _settings.supabase_service_role_key,
    _settings.supabase_storage_bucket,
)
pdf_bucket_store.ensure_bucket()

_TEST_EMAIL = "calibration-e2e@example.com"
# Deterministic, derived from the (secret) service key — stable across runs,
# no literal password in the repo.
_TEST_PASSWORD = (
    "E2e!" + hashlib.sha256((_settings.supabase_service_role_key + "|e2e").encode()).hexdigest()[:24]
)


def _provision_technician() -> tuple[str, str, str]:
    """Returns (access_token, subject_uuid, display_name)."""
    base = f"{_settings.supabase_url.rstrip('/')}/auth/v1"
    key = _settings.supabase_service_role_key
    admin = httpx.Client(
        timeout=30, headers={"apikey": key, "Authorization": f"Bearer {key}"}
    )

    created = admin.post(
        f"{base}/admin/users",
        json={
            "email": _TEST_EMAIL,
            "password": _TEST_PASSWORD,
            "email_confirm": True,
            "user_metadata": {"full_name": "E2E Technician"},
        },
    )
    if created.status_code in (200, 201):
        user_id = created.json()["id"]
    else:
        # Already exists (or similar) — find it and reset the password.
        listing = admin.get(f"{base}/admin/users", params={"page": 1, "per_page": 100})
        listing.raise_for_status()
        users = listing.json().get("users", [])
        match = next((u for u in users if u.get("email") == _TEST_EMAIL), None)
        if match is None:
            pytest.exit(
                f"Could not provision test user ({created.status_code}): {created.text[:300]}",
                returncode=1,
            )
        user_id = match["id"]

    # The backend only accepts azure/google/apple identities; mark the test
    # account as an Azure identity so the token passes the provider gate.
    updated = admin.put(
        f"{base}/admin/users/{user_id}",
        json={
            "password": _TEST_PASSWORD,
            "email_confirm": True,
            "app_metadata": {"provider": "azure", "providers": ["azure"]},
            "user_metadata": {"full_name": "E2E Technician"},
        },
    )
    if updated.status_code not in (200, 201):
        pytest.exit(
            f"Could not update test user ({updated.status_code}): {updated.text[:300]}",
            returncode=1,
        )

    login = httpx.post(
        f"{base}/token?grant_type=password",
        headers={"apikey": key},
        json={"email": _TEST_EMAIL, "password": _TEST_PASSWORD},
        timeout=30,
    )
    if login.status_code != 200:
        pytest.exit(
            "Could not sign the test user in (is the email provider enabled in "
            f"Supabase Auth?) ({login.status_code}): {login.text[:300]}",
            returncode=1,
        )
    body = login.json()
    return body["access_token"], body["user"]["id"], "E2E Technician"


ACCESS_TOKEN, TECHNICIAN_SUBJECT, TECHNICIAN_NAME = _provision_technician()

from fastapi.testclient import TestClient  # noqa: E402
from reportlab.lib.pagesizes import A4  # noqa: E402
from reportlab.pdfgen import canvas  # noqa: E402

from scripts.generate_dev_signing_cert import generate as generate_dev_cert  # noqa: E402
from app.main import app  # noqa: E402
from app.tolerance import compute_efd  # noqa: E402

generate_dev_cert(_KEYS)


def make_delivery(point: str, vfd_ml: float, vref_ml: float, flow_rate_lpm: float = 40.0) -> dict:
    c = compute_efd(vfd_ml, vref_ml)
    return {
        "point": point,
        "flowRateLpm": flow_rate_lpm,
        "vfdMl": vfd_ml,
        "vrefMl": vref_ml,
        "efdPercent": c.efd_percent,
        "pass": c.passed,
    }


def _all_pass_checklist() -> dict:
    return {
        "constructionMarking": "pass",
        "computerComputation": "pass",
        "hydraulics": "pass",
        "interlockingDevices": "pass",
        "hoseNozzleAutoStop": "pass",
        "solenoidValveTest": "pass",
        "presetTest": "pass",
        "measuresConformSans1698": "pass",
        "timeOut": "pass",
        "nozzleBurst": "pass",
        "zeroSetting": "pass",
    }


def make_hose(**overrides) -> dict:
    hose = {
        "hoseNumber": "1",
        "product": "ULP 95",
        "status": "new",
        "components": {
            "meter": {"make": "Tatsuno", "model": "TF", "serial": "M-001", "saApproval": "119-AA20"},
            "pcBoard": {"make": "Tatsuno", "model": "PB", "serial": "P-001", "saApproval": "119-AA20"},
            "pulsar": {"make": "Tatsuno", "model": "PL", "serial": "PU-001", "saApproval": "119-AA20"},
            "solenoid": {"make": "Tatsuno", "model": "SV", "serial": "S-001", "saApproval": "119-AA20"},
        },
        "testCondition": "cold",
        "qMinLpm": 15,
        "qMaxLpm": 130,
        "checklist": _all_pass_checklist(),
        "deliveries": [
            make_delivery("del1_max", 20010, 20000),
            make_delivery("del2_max", 20010, 20000),
            make_delivery("del3_max", 20000, 20000),
            make_delivery("min_flow", 5005, 5000),
        ],
        "outcome": "certified",
    }
    hose.update(overrides)
    return hose


def make_valid_verification(cert_number: str | None = None) -> dict:
    cert_number = cert_number or f"PWC-JHB-{uuid.uuid4().int % 1_000_000:06d}-00"
    return {
        "schemaVersion": 2,
        "certificateNumber": cert_number,
        "nrcsBookNumber": "139458",
        "reportType": "verification",
        "site": {
            "customerName": "Engen",
            "siteName": "North Road Fuel Depot",
            "address": "75 North Road, O.R. Tambo, Boksburg, 1459",
            "telephone": "011 617 6000",
        },
        "jobReference": "WO-4711",
        "workOrderId": "WO-001",
        "dispenser": {
            "dispenserId": "DISP-001",
            "makeModel": "Tatsuno SS-LX-E",
            "saApprovalNumber": "119-AA20",
            "serialNumber": "TSN-99812",
            "securitySealNumber": "SEC-114281",
        },
        "referenceMeasures": [
            {
                "size": "200L",
                "serialNumber": "PRO-1148D",
                "certificateNumber": "D83126",
                "calibrationDate": "2026-03-19",
                "expiryDate": "2027-03-19",
            },
            {
                "size": "20L",
                "serialNumber": "PRO-1103T",
                "certificateNumber": "D83126",
                "calibrationDate": "2026-03-19",
                "expiryDate": "2027-03-19",
            },
        ],
        "methodReference": "SANS Test Proc 01 & SANS Test Proc 02 based on LM-IR 117-2: 2023",
        "hoses": [make_hose()],
        "signOff": {
            # The real Supabase user — the backend enforces that the token
            # subject matches the signing VO's subject.
            "vo": {
                "identity": {
                    "subject": TECHNICIAN_SUBJECT,
                    "name": TECHNICIAN_NAME,
                    "authMethod": "microsoft",
                },
                "pliersNumber": "PRO 399",
            },
            "client": {"name": "K. Moja"},
            "declarationAccepted": True,
            "expiryDate": "2027-07-14",
        },
        "verificationDate": "2026-07-10",
    }


def build_certificate_pdf(verification: dict) -> bytes:
    """Minimal stand-in for the expo-print rendering: a PDF whose text layer
    contains the fields the backend cross-checks."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    lines = [
        "VERIFICATION CERTIFICATE — LIQUID FUEL DISPENSERS",
        f"Certificate number: {verification['certificateNumber']}",
        f"Oil Company: {verification['site']['customerName']}",
        f"Serial No.: {verification['dispenser']['serialNumber']}",
        f"VO: {verification['signOff']['vo']['identity']['name']}",
    ]
    for hi, hose in enumerate(verification["hoses"]):
        for d in hose["deliveries"]:
            lines.append(
                f"Hose {hose['hoseNumber']} {d['point']}: "
                f"VFD {d['vfdMl']:.0f} ml VREF {d['vrefMl']:.0f} ml "
                f"EFD {d['efdPercent']:.2f} %"
            )
    for line in lines:
        c.drawString(40, y, line)
        y -= 18
    c.showPage()
    c.save()
    return buf.getvalue()


def make_submission(verification: dict | None = None, pdf: bytes | None = None) -> dict:
    verification = verification or make_valid_verification()
    pdf = pdf if pdf is not None else build_certificate_pdf(verification)
    return {
        "idempotencyKey": str(uuid.uuid4()),
        "verification": verification,
        "pdfSha256": hashlib.sha256(pdf).hexdigest(),
        "pdfBase64": base64.b64encode(pdf).decode(),
        "intentToSign": {
            "deviceTimestamp": "2026-07-14T08:59:31Z",
            "deviceId": "device-e2e",
            "gps": {
                "latitude": -26.2041,
                "longitude": 28.0473,
                "accuracyM": 8,
                "consentGiven": True,
            },
        },
    }


@pytest.fixture()
def client():
    """Authenticated client — carries the real Supabase JWT."""
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {ACCESS_TOKEN}"})
        yield c


@pytest.fixture()
def raw_client():
    """Unauthenticated client, for testing the auth gate itself."""
    with TestClient(app) as c:
        yield c
