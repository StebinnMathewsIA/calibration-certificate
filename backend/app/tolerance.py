"""Python mirror of shared/schema/src/tolerance.ts.

Keep behaviour byte-for-byte consistent with the TypeScript implementation:
the backend recomputes every result row and rejects submissions whose
client-computed values disagree.

The MPE values are PROVISIONAL — confirm the exact NRCS / OIML R117 accuracy
class per dispenser type with Prowalco's quality manager (CLAUDE.md, open
question #1).
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class ToleranceClass:
    id: str
    name: str
    mpe_percent: float
    reference: str


TOLERANCE_CLASSES: dict[str, ToleranceClass] = {
    "oiml_r117_class_0_5": ToleranceClass(
        id="oiml_r117_class_0_5",
        name="OIML R117 accuracy class 0.5 (fuel dispenser)",
        mpe_percent=0.5,
        reference="OIML R117-1 — PROVISIONAL, confirm with NRCS/QM",
    ),
    "oiml_r117_class_0_3": ToleranceClass(
        id="oiml_r117_class_0_3",
        name="OIML R117 accuracy class 0.3",
        mpe_percent=0.3,
        reference="OIML R117-1 — PROVISIONAL, confirm with NRCS/QM",
    ),
}

DEFAULT_TOLERANCE_CLASS_ID = "oiml_r117_class_0_5"

# Match the TS EPSILON nudge in roundTo(): Python's round() uses banker's
# rounding, so implement half-up rounding with the same epsilon behaviour.
_EPSILON = 2.220446049250313e-16
import math


def round_to(value: float, decimals: int) -> float:
    # JS Math.round(x) === floor(x + 0.5) for all x, including negatives —
    # use the same formula so both implementations agree at .5 boundaries.
    f = 10.0**decimals
    return math.floor((value + _EPSILON) * f + 0.5) / f


@dataclass(frozen=True)
class RowComputation:
    error_ml: float
    error_percent: float
    passed: bool


def compute_row(
    indicated_volume_l: float,
    measured_volume_l: float,
    tolerance_class_id: str = DEFAULT_TOLERANCE_CLASS_ID,
) -> RowComputation:
    tol = TOLERANCE_CLASSES.get(tolerance_class_id)
    if tol is None:
        raise ValueError(f"Unknown tolerance class: {tolerance_class_id}")
    if measured_volume_l <= 0:
        raise ValueError("Measured volume must be > 0")
    error_l = indicated_volume_l - measured_volume_l
    error_ml = round_to(error_l * 1000, 1)
    error_percent = round_to((error_l / measured_volume_l) * 100, 3)
    return RowComputation(
        error_ml=error_ml,
        error_percent=error_percent,
        passed=abs(error_percent) <= tol.mpe_percent,
    )
