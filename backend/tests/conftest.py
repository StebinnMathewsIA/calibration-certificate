import base64
import hashlib
import io
import os
import sys
import tempfile
import uuid
from pathlib import Path

# Environment must be configured before app modules are imported (settings
# and the DB engine are resolved at import time).
_TMP = Path(tempfile.mkdtemp(prefix="prowalco-test-"))
os.environ["DATABASE_URL"] = f"sqlite:///{_TMP}/test.sqlite3"
os.environ["AUTH_MODE"] = "disabled"
os.environ["SIGNING_KEY_DIR"] = str(_TMP / "dev-keys")
os.environ["TSA_URL"] = ""
os.environ["ANALYSIS_ENABLED"] = "true"

BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from scripts.generate_dev_signing_cert import generate as generate_dev_cert
from app.main import app
from app.tolerance import DEFAULT_TOLERANCE_CLASS_ID, compute_row

generate_dev_cert(_TMP / "dev-keys")

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


def make_valid_form(cert_number: str = "PWC-JHB-000123-00") -> dict:
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
            "calibratedBy": {
                "subject": "dev|local",
                "name": "T. Ngcobo",
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
            "deviceId": "device-abc",
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
    with TestClient(app) as c:
        yield c
