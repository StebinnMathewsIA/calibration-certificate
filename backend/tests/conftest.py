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
from app.tolerance import DEFAULT_TOLERANCE_CLASS_ID, compute_row  # noqa: E402

generate_dev_cert(_KEYS)

UNCERTAINTY = (
    "Expanded uncertainty of measurement: ±0.15 % of reading, coverage factor k=2 "
    "(approx. 95 % confidence). PROVISIONAL — pending Prowalco uncertainty budget."
)


def make_row(indicated: float, measured: float, nominal: float = 20.0) -> dict:
    c = compute_row(indicated, measured, DEFAULT_TOLERANCE_CLASS_ID)
    return {
        "nominalDeliveryL": nominal,
        "flowRateLpm": 38.5,
        "indicatedVolumeL": indicated,
        "measuredVolumeL": measured,
        "errorMl": c.error_ml,
        "errorPercent": c.error_percent,
        "pass": c.passed,
        "toleranceClassId": DEFAULT_TOLERANCE_CLASS_ID,
    }


def make_valid_form(cert_number: str | None = None) -> dict:
    cert_number = cert_number or f"PWC-JHB-{uuid.uuid4().int % 1_000_000:06d}-00"
    return {
        "schemaVersion": 1,
        "job": {
            "certificateNumber": cert_number,
            "workOrderNumber": "WO-4711",
            "customerName": "Engen Riverside",
            "siteAddress": "1 Main Rd, Johannesburg, 2001",
            "siteAssetNumber": "FC-07",
            "calibrationDate": "2026-07-10",
        },
        "uut": {
            "equipmentType": "fuel_dispenser",
            "manufacturer": "Tatsuno",
            "modelNumber": "SS-LX-E",
            "serialNumber": "TSN-99812",
            "nozzleId": "A1",
            "productGrade": "ulp_95",
            "meterKFactorBefore": 1.0012,
        },
        "referenceStandards": [
            {
                "registerId": "STD-001",
                "description": "20 L proving measure",
                "serialNumber": "PM-2044",
                "certificateNumber": "SANAS-CAL-8871",
                "calibrationDueDate": "2027-01-31",
            }
        ],
        "environment": {
            "ambientTempC": 24.5,
            "productTempC": 21.0,
            "procedureRef": "PWC-CP-001",
            "uutCondition": "good",
        },
        "results": {
            "asFound": [make_row(20.05, 20.0), make_row(19.98, 20.0)],
            "adjustmentPerformed": False,
            "uncertaintyStatement": UNCERTAINTY,
            "verificationSealNumbers": ["SEAL-1234"],
            "photos": [],
        },
        "signOff": {
            # The real Supabase user — the backend enforces that the token
            # subject matches calibratedBy.subject.
            "calibratedBy": {
                "subject": TECHNICIAN_SUBJECT,
                "name": TECHNICIAN_NAME,
                "authMethod": "microsoft",
            },
            "technicalSignatory": {"id": "SIG-01", "name": "P. van Wyk"},
            "declarationAccepted": True,
        },
    }


def build_certificate_pdf(form: dict) -> bytes:
    """Minimal stand-in for the expo-print rendering: a PDF whose text layer
    contains the fields the backend cross-checks."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    y = 800
    lines = [
        "CERTIFICATE OF CALIBRATION",
        f"Certificate number: {form['job']['certificateNumber']}",
        f"Customer: {form['job']['customerName']}",
        f"UUT serial number: {form['uut']['serialNumber']}",
        f"Calibrated by: {form['signOff']['calibratedBy']['name']}",
    ]
    for table in ("asFound", "asLeft"):
        for row in form["results"].get(table) or []:
            lines.append(
                f"{table}: nominal {row['nominalDeliveryL']:.2f} L "
                f"indicated {row['indicatedVolumeL']:.3f} L "
                f"measured {row['measuredVolumeL']:.3f} L "
                f"error {row['errorMl']:.1f} mL ({row['errorPercent']:.3f} %)"
            )
    for line in lines:
        c.drawString(40, y, line)
        y -= 18
    c.showPage()
    c.save()
    return buf.getvalue()


def make_submission(form: dict | None = None, pdf: bytes | None = None) -> dict:
    form = form or make_valid_form()
    pdf = pdf if pdf is not None else build_certificate_pdf(form)
    return {
        "idempotencyKey": str(uuid.uuid4()),
        "form": form,
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
