"""Python mirror of shared/schema/src/readiness.ts (cross-field checks).

Run AFTER schema_validation.validate_verification — this module assumes the
structural shape is already valid.
"""
from datetime import datetime, timezone

from .tolerance import compute_efd

_EPSILON_PCT = 0.005001


def _check_delivery(d: dict, label: str, reasons: list[str]) -> None:
    if d["vrefMl"] <= 0:
        reasons.append(f"{label}: VREF must be greater than 0")
        return
    expected = compute_efd(d["vfdMl"], d["vrefMl"])
    if abs(expected.efd_percent - d["efdPercent"]) > _EPSILON_PCT:
        reasons.append(f"{label}: EFD (%) does not match recomputed value")
    if expected.passed != d["pass"]:
        reasons.append(f"{label}: pass/fail flag does not match recomputed value")


def _check_hose(hose: dict, label: str, reasons: list[str]) -> None:
    for i, d in enumerate(hose["deliveries"]):
        _check_delivery(d, f'{label}.deliveries[{i}] ({d["point"]})', reasons)

    any_delivery_failed = any(not d["pass"] for d in hose["deliveries"])
    any_checklist_failed = any(v == "fail" for v in hose["checklist"].values())
    if hose["outcome"] == "certified" and (any_delivery_failed or any_checklist_failed):
        reasons.append(
            f'{label}: outcome is "certified" but a delivery or checklist item failed'
        )
    if hose["outcome"] == "rejected" and not any_delivery_failed and not any_checklist_failed:
        reasons.append(
            f'{label}: outcome is "rejected" but no delivery or checklist item failed'
        )


def validate_ready_to_sign(verification: dict, now: datetime | None = None) -> list[str]:
    """Returns a list of reasons the verification may NOT be signed (empty = ready)."""
    reasons: list[str] = []
    now = now or datetime.now(timezone.utc)
    today = now.date().isoformat()

    sign_off = verification["signOff"]
    if not sign_off["declarationAccepted"]:
        reasons.append(
            "signOff.declarationAccepted: the declaration must be accepted before signing"
        )
    if not sign_off["vo"].get("pliersNumber"):
        reasons.append("signOff.vo.pliersNumber: the VO pliers number is required")

    ver_date = verification["verificationDate"]
    for m in verification["referenceMeasures"]:
        exp = m["expiryDate"]
        if exp < ver_date:
            reasons.append(
                f'referenceMeasures: {m["size"]} measure ({m["serialNumber"]}) expired '
                f"{exp}, before the verification date {ver_date}"
            )
        elif exp < today:
            reasons.append(
                f'referenceMeasures: {m["size"]} measure ({m["serialNumber"]}) expired {exp}'
            )

    if ver_date > today:
        reasons.append("verificationDate: verification date is in the future")

    any_rejected = any(h["outcome"] == "rejected" for h in verification["hoses"])
    if any_rejected and not sign_off.get("rejectionCertNumber"):
        reasons.append(
            "signOff.rejectionCertNumber: required because at least one hose was rejected"
        )

    for i, hose in enumerate(verification["hoses"]):
        _check_hose(hose, f"hoses[{i}]", reasons)

    return reasons
