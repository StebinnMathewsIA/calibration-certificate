import base64
import hashlib
import io
import os
import uuid

from pyhanko.keys import load_cert_from_pemder
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.validation import validate_pdf_signature
from pyhanko_certvalidator import ValidationContext

from tests.conftest import (
    build_certificate_pdf,
    make_submission,
    make_valid_form,
    pdf_bucket_store,
)


def _fresh_cert_number() -> str:
    return f"PWC-JHB-{uuid.uuid4().int % 1_000_000:06d}-00"


def _fresh_submission():
    form = make_valid_form(cert_number=_fresh_cert_number())
    return make_submission(form)


def test_sign_happy_path_produces_valid_pades_signature(client):
    sub = _fresh_submission()
    resp = client.post("/v1/certificates/sign", json=sub)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "issued"
    assert body["certificateNumber"] == sub["form"]["job"]["certificateNumber"]

    signed = base64.b64decode(body["signedPdfBase64"])
    assert hashlib.sha256(signed).hexdigest() == body["signedPdfSha256"]

    # The signed PDF landed in the real Supabase Storage bucket.
    cert_number = sub["form"]["job"]["certificateNumber"]
    assert pdf_bucket_store.get(f"{cert_number}.pdf") == signed

    # The signed PDF must carry an intact, cryptographically valid signature
    # chaining to the dev signing cert.
    dev_cert = load_cert_from_pemder(
        os.path.join(os.environ["SIGNING_KEY_DIR"], "signing-cert.pem")
    )
    vc = ValidationContext(trust_roots=[dev_cert], allow_fetching=False)
    reader = PdfFileReader(io.BytesIO(signed))
    sigs = reader.embedded_signatures
    assert len(sigs) == 1
    status = validate_pdf_signature(sigs[0], vc)
    assert status.intact
    assert status.valid


def test_idempotent_replay_returns_same_certificate(client):
    sub = _fresh_submission()
    first = client.post("/v1/certificates/sign", json=sub)
    second = client.post("/v1/certificates/sign", json=sub)
    assert first.status_code == 200 and second.status_code == 200
    a, b = first.json(), second.json()
    # Retry never double-signs: identical signature, hash, and audit id.
    assert a["signatureId"] == b["signatureId"]
    assert a["signedPdfSha256"] == b["signedPdfSha256"]
    assert a["auditId"] == b["auditId"]


def test_same_certificate_number_different_key_conflicts(client):
    sub = _fresh_submission()
    assert client.post("/v1/certificates/sign", json=sub).status_code == 200
    dup = make_submission(sub["form"])  # new idempotency key, same cert number
    resp = client.post("/v1/certificates/sign", json=dup)
    assert resp.status_code == 409


def test_pdf_hash_mismatch_rejected(client):
    sub = _fresh_submission()
    sub["pdfSha256"] = "0" * 64
    resp = client.post("/v1/certificates/sign", json=sub)
    assert resp.status_code == 400
    assert "pdfSha256" in resp.text


def test_crosscheck_blocks_mismatched_pdf(client):
    # PDF rendered for a DIFFERENT form (wrong cert number / values) must not
    # be signed even though hash and schema are fine.
    form = make_valid_form(cert_number=_fresh_cert_number())
    other = make_valid_form(cert_number=_fresh_cert_number())
    other["signOff"]["calibratedBy"]["name"] = "Someone Else"
    mismatched_pdf = build_certificate_pdf(other)
    sub = make_submission(form, pdf=mismatched_pdf)
    resp = client.post("/v1/certificates/sign", json=sub)
    assert resp.status_code == 422
    assert "text layer" in resp.text


def test_tampered_results_rejected_before_signing(client):
    form = make_valid_form(cert_number=_fresh_cert_number())
    form["results"]["asFound"][0]["pass"] = True
    form["results"]["asFound"][0]["errorPercent"] = 0.01
    sub = make_submission(form)
    resp = client.post("/v1/certificates/sign", json=sub)
    assert resp.status_code == 422


def test_token_subject_must_match_technician(client):
    form = make_valid_form(cert_number=_fresh_cert_number())
    form["signOff"]["calibratedBy"]["subject"] = "someone-else-uuid"
    resp = client.post("/v1/certificates/sign", json=make_submission(form))
    assert resp.status_code == 403


def test_structurally_invalid_submission_rejected(client):
    sub = _fresh_submission()
    del sub["form"]["referenceStandards"]
    resp = client.post("/v1/certificates/sign", json=sub)
    assert resp.status_code == 422


def test_receipt_confirms_sync(client):
    sub = _fresh_submission()
    cert_number = sub["form"]["job"]["certificateNumber"]
    assert client.post("/v1/certificates/sign", json=sub).status_code == 200
    resp = client.get(f"/v1/certificates/{cert_number}/receipt")
    assert resp.status_code == 200
    assert resp.json()["certificateNumber"] == cert_number


def test_reserve_number_sequences_per_branch(client):
    r1 = client.post("/v1/certificates/reserve-number", json={"branch": "CPT"})
    r2 = client.post("/v1/certificates/reserve-number", json={"branch": "CPT"})
    n1, n2 = r1.json()["certificateNumber"], r2.json()["certificateNumber"]
    assert n1.startswith("PWC-CPT-") and n1.endswith("-00")
    assert int(n2.split("-")[2]) == int(n1.split("-")[2]) + 1
    assert client.post("/v1/certificates/reserve-number", json={"branch": "x!"}).status_code == 422
