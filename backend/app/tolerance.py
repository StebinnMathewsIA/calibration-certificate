"""Python mirror of shared/schema/src/tolerance.ts.

Keep behaviour consistent with the TypeScript implementation: the backend
recomputes every delivery's EFD and rejects submissions whose client-computed
values disagree.

    EFD = (VFD - VREF) / VREF * 100   [%]

VFD = volume indicated by the dispenser, VREF = volume indicated by the
reference measure. A delivery passes when |EFD| <= MPE.

MPE CONFIRMED (owner, 2026-07-31): SANS TEST PROC02 rev 14, Table 1
(LM-IR 117-1), accuracy class 0.5, Line A = 0.5 percent, the cell
highlighted as applicable in Prowalco's controlled procedure.
"""
import math
from dataclasses import dataclass

# Maximum permissible error for a fuel-dispenser delivery, in percent.
MPE_PERCENT = 0.5

# The delivery test points on the Metrologist Note, in report order.
DELIVERY_POINTS = ("del1_max", "del2_max", "del3_max", "min_flow_20l", "min_flow", "preset")

# Match the TS EPSILON nudge in roundTo(): Python's round() uses banker's
# rounding, so implement half-up rounding with the same epsilon behaviour.
_EPSILON = 2.220446049250313e-16


def round_to(value: float, decimals: int) -> float:
    # JS Math.round(x) === floor(x + 0.5) for all x, including negatives —
    # use the same formula so both implementations agree at .5 boundaries.
    f = 10.0**decimals
    return math.floor((value + _EPSILON) * f + 0.5) / f


@dataclass(frozen=True)
class EfdComputation:
    efd_percent: float
    passed: bool


def compute_efd(vfd_ml: float, vref_ml: float) -> EfdComputation:
    if vref_ml <= 0:
        raise ValueError("Reference volume (VREF) must be > 0")
    efd_percent = round_to(((vfd_ml - vref_ml) / vref_ml) * 100, 2)
    return EfdComputation(
        efd_percent=efd_percent,
        passed=abs(efd_percent) <= MPE_PERCENT,
    )
