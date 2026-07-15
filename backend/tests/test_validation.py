from datetime import datetime, timezone

from app.readiness import validate_ready_to_sign
from app.schema_validation import validate_sign_submission, validate_verification
from tests.conftest import make_hose, make_submission, make_valid_verification

NOW = datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc)


def test_valid_verification_passes_schema_and_readiness():
    v = make_valid_verification()
    assert validate_verification(v) == []
    assert validate_ready_to_sign(v, now=NOW) == []


def test_bad_certificate_number_caught_by_shared_schema():
    v = make_valid_verification()
    v["certificateNumber"] = "BAD-FORMAT"
    violations = validate_verification(v)
    assert any("certificateNumber" in x for x in violations)


def test_missing_required_field_caught():
    v = make_valid_verification()
    del v["methodReference"]
    assert validate_verification(v)


def test_expired_reference_measure_blocks_signing():
    v = make_valid_verification()
    v["referenceMeasures"][0]["expiryDate"] = "2026-01-01"
    reasons = validate_ready_to_sign(v, now=NOW)
    assert any("expired" in r for r in reasons)


def test_tampered_efd_rejected():
    v = make_valid_verification()
    v["hoses"][0]["deliveries"][0]["efdPercent"] = 0.01  # true value 0.05
    reasons = validate_ready_to_sign(v, now=NOW)
    assert any("EFD" in r for r in reasons)


def test_tampered_pass_flag_rejected():
    v = make_valid_verification()
    v["hoses"][0]["deliveries"].append(
        {
            "point": "preset",
            "flowRateLpm": 40,
            "vfdMl": 20150,
            "vrefMl": 20000,
            "efdPercent": 0.75,
            "pass": True,  # lie
        }
    )
    reasons = validate_ready_to_sign(v, now=NOW)
    assert any("pass/fail" in r for r in reasons)


def test_certified_with_failed_checklist_rejected():
    v = make_valid_verification()
    v["hoses"][0]["checklist"]["hydraulics"] = "fail"
    reasons = validate_ready_to_sign(v, now=NOW)
    assert any("certified" in r for r in reasons)


def test_rejected_hose_requires_rejection_cert_number():
    v = make_valid_verification()
    hose = make_hose(outcome="rejected")
    hose["checklist"]["solenoidValveTest"] = "fail"
    v["hoses"] = [hose]
    reasons = validate_ready_to_sign(v, now=NOW)
    assert any("rejectionCertNumber" in r for r in reasons)


def test_declaration_required():
    v = make_valid_verification()
    v["signOff"]["declarationAccepted"] = False
    reasons = validate_ready_to_sign(v, now=NOW)
    assert any("declaration" in r for r in reasons)


def test_submission_envelope_validates():
    assert validate_sign_submission(make_submission()) == []


def test_gps_without_consent_rejected():
    sub = make_submission()
    sub["intentToSign"]["gps"]["consentGiven"] = False
    violations = validate_sign_submission(sub)
    assert any("consentGiven" in v for v in violations)
