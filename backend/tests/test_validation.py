from datetime import datetime, timezone

from app.readiness import validate_ready_to_sign
from app.schema_validation import validate_calibration_form, validate_sign_submission
from tests.conftest import make_row, make_submission, make_valid_form

NOW = datetime(2026, 7, 14, 9, 0, tzinfo=timezone.utc)


def test_valid_form_passes_schema_and_readiness():
    form = make_valid_form()
    assert validate_calibration_form(form) == []
    assert validate_ready_to_sign(form, now=NOW) == []


def test_bad_certificate_number_caught_by_shared_schema():
    form = make_valid_form()
    form["job"]["certificateNumber"] = "BAD-FORMAT"
    violations = validate_calibration_form(form)
    assert any("certificateNumber" in v for v in violations)


def test_missing_required_field_caught():
    form = make_valid_form()
    del form["environment"]["procedureRef"]
    assert validate_calibration_form(form)


def test_expired_standard_blocks_signing():
    form = make_valid_form()
    form["referenceStandards"][0]["calibrationDueDate"] = "2026-01-01"
    reasons = validate_ready_to_sign(form, now=NOW)
    assert any("expired" in r for r in reasons)


def test_tampered_error_percent_rejected():
    form = make_valid_form()
    form["results"]["asFound"][0]["errorPercent"] = 0.01  # true value 0.25
    reasons = validate_ready_to_sign(form, now=NOW)
    assert any("error (%)" in r for r in reasons)


def test_tampered_pass_flag_rejected():
    form = make_valid_form()
    row = make_row(20.15, 20.0)  # genuinely out of tolerance
    row["pass"] = True  # lie about it
    form["results"]["asFound"].append(row)
    reasons = validate_ready_to_sign(form, now=NOW)
    assert any("pass/fail" in r for r in reasons)


def test_adjustment_requires_as_left():
    form = make_valid_form()
    form["results"]["adjustmentPerformed"] = True
    reasons = validate_ready_to_sign(form, now=NOW)
    assert any("as-left" in r.lower() for r in reasons)


def test_declaration_required():
    form = make_valid_form()
    form["signOff"]["declarationAccepted"] = False
    reasons = validate_ready_to_sign(form, now=NOW)
    assert any("declaration" in r for r in reasons)


def test_submission_envelope_validates():
    assert validate_sign_submission(make_submission()) == []


def test_gps_without_consent_rejected():
    sub = make_submission()
    sub["intentToSign"]["gps"]["consentGiven"] = False
    violations = validate_sign_submission(sub)
    assert any("consentGiven" in v for v in violations)
