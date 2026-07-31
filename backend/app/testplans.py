"""Test-plan registry consumer (#92).

The registry is authored ONCE in TypeScript (shared/schema/src/test-plans.ts)
and generated into shared/schema/json/test-plans.json by the schema codegen,
so this module never hand-mirrors plan contents.

Validation is deliberately scoped: it applies ONLY when a submission declares
its testPlan. Payloads without the field (everything queued before the
registry shipped, and any legacy client) are lfd-std-v1 by definition and are
NOT checked against nominals, because older plans legitimately differ (e.g.
the pre-#87 20 L preset).
"""
import json
from functools import lru_cache

from .config import SHARED_SCHEMA_JSON_DIR

DEFAULT_TEST_PLAN_ID = "lfd-std-v1"


@lru_cache
def test_plans() -> dict:
    return json.loads((SHARED_SCHEMA_JSON_DIR / "test-plans.json").read_text())


def validate_plan_consistency(verification: dict) -> list[str]:
    """Declared plan must exist, and every delivery must be one of its points
    with the plan's fixed nominal VFD."""
    plan_id = verification.get("testPlan")
    if not plan_id:
        return []
    plan = test_plans().get(plan_id)
    if plan is None:
        return [f"testPlan: unknown plan {plan_id!r}"]
    nominal_by_point = {d["point"]: d["nominalMl"] for d in plan["deliveries"]}
    problems: list[str] = []
    for hi, hose in enumerate(verification.get("hoses", [])):
        for di, d in enumerate(hose.get("deliveries", [])):
            point = d.get("point")
            if point not in nominal_by_point:
                problems.append(
                    f"hoses[{hi}].deliveries[{di}].point: {point!r} is not part of plan {plan_id}"
                )
                continue
            if d.get("vfdMl") != nominal_by_point[point]:
                problems.append(
                    f"hoses[{hi}].deliveries[{di}].vfdMl: {d.get('vfdMl')!r} does not match "
                    f"plan {plan_id} nominal {nominal_by_point[point]} for {point}"
                )
    return problems
