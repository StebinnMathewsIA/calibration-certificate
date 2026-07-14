"""Python mirror of shared/schema/src/readiness.ts (cross-field checks).

Run AFTER schema_validation.validate_calibration_form — this module assumes
the structural shape is already valid.
"""
from datetime import date, datetime, timezone

from .tolerance import TOLERANCE_CLASSES, compute_row

_EPSILON_ML = 0.05001
_EPSILON_PCT = 0.0005001


def _check_row(row: dict, label: str, reasons: list[str]) -> None:
    tol_id = row["toleranceClassId"]
    if tol_id not in TOLERANCE_CLASSES:
        reasons.append(f'{label}: unknown tolerance class "{tol_id}"')
        return
    expected = compute_row(row["indicatedVolumeL"], row["measuredVolumeL"], tol_id)
    if abs(expected.error_ml - row["errorMl"]) > _EPSILON_ML:
        reasons.append(f"{label}: error (mL) does not match recomputed value")
    if abs(expected.error_percent - row["errorPercent"]) > _EPSILON_PCT:
        reasons.append(f"{label}: error (%) does not match recomputed value")
    if expected.passed != row["pass"]:
        reasons.append(f"{label}: pass/fail flag does not match recomputed value")
    if abs(row["indicatedVolumeL"] - row["nominalDeliveryL"]) > row["nominalDeliveryL"] * 0.5:
        reasons.append(f"{label}: indicated volume differs from nominal by more than 50%")


def validate_ready_to_sign(form: dict, now: datetime | None = None) -> list[str]:
    """Returns a list of reasons the form may NOT be signed (empty = ready)."""
    reasons: list[str] = []
    now = now or datetime.now(timezone.utc)
    today = now.date().isoformat()

    if not form["signOff"]["declarationAccepted"]:
        reasons.append(
            "signOff.declarationAccepted: the declaration must be accepted before signing"
        )

    cal_date = form["job"]["calibrationDate"]
    for std in form["referenceStandards"]:
        due = std["calibrationDueDate"]
        if due < cal_date:
            reasons.append(
                f'referenceStandards: "{std["description"]}" ({std["serialNumber"]}) '
                f"calibration expired {due}, before the calibration date {cal_date}"
            )
        elif due < today:
            reasons.append(
                f'referenceStandards: "{std["description"]}" ({std["serialNumber"]}) '
                f"calibration expired {due}"
            )

    if cal_date > today:
        reasons.append("job.calibrationDate: calibration date is in the future")

    results = form["results"]
    if results["adjustmentPerformed"] and not results.get("asLeft"):
        reasons.append("results.asLeft: as-left results are required when an adjustment was performed")
    if not results["adjustmentPerformed"] and results.get("asLeft"):
        reasons.append("results.asLeft: as-left results present but adjustmentPerformed is false")

    for i, row in enumerate(results["asFound"]):
        _check_row(row, f"results.asFound[{i}]", reasons)
    for i, row in enumerate(results.get("asLeft") or []):
        _check_row(row, f"results.asLeft[{i}]", reasons)

    return reasons
