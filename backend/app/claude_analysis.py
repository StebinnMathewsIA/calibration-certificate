"""Claude calibration analysis (backend-only — API key never ships in the app).

Sends the structured calibration JSON to the Claude API and returns a
structured verdict matching shared/schema/src/analysis.ts. The prompt is
versioned in-repo (app/prompts/) and the verdict + model + prompt version are
written to the audit trail by the caller.
"""
import json
from datetime import datetime, timezone
from functools import lru_cache

import anthropic

from .config import PROMPTS_DIR, get_settings
from .tolerance import TOLERANCE_CLASSES

PROMPT_VERSION = "calibration-analysis-v1"

# Mirrors shared/schema/src/analysis.ts analysisResultSchema.
ANALYSIS_RESULT_JSON_SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": ["pass", "marginal", "fail", "data_anomaly"]},
        "summary": {"type": "string"},
        "concerns": {"type": "array", "items": {"type": "string"}},
        "recommendations": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["verdict", "summary", "concerns", "recommendations"],
    "additionalProperties": False,
}


@lru_cache
def _system_prompt() -> str:
    return (PROMPTS_DIR / "calibration_analysis_v1.md").read_text()


def _tolerance_context() -> list[dict]:
    return [
        {"id": t.id, "name": t.name, "mpePercent": t.mpe_percent, "reference": t.reference}
        for t in TOLERANCE_CLASSES.values()
    ]


def analyze_calibration(form: dict, client: anthropic.Anthropic | None = None) -> dict:
    """Returns an AnalysisResponse dict (see shared/schema/src/analysis.ts).

    Raises anthropic.APIError subclasses on API failure — the router maps
    those to HTTP errors. `client` is injectable for tests.
    """
    settings = get_settings()
    client = client or anthropic.Anthropic()

    user_content = json.dumps(
        {
            "tolerancesInForce": _tolerance_context(),
            "calibration": form,
        },
        indent=2,
        sort_keys=True,
    )

    response = client.messages.create(
        model=settings.anthropic_model,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        system=[
            {
                "type": "text",
                "text": _system_prompt(),
                # The system prompt is identical across all analyses — cache it.
                "cache_control": {"type": "ephemeral"},
            }
        ],
        output_config={"format": {"type": "json_schema", "schema": ANALYSIS_RESULT_JSON_SCHEMA}},
        messages=[{"role": "user", "content": user_content}],
    )

    if response.stop_reason == "refusal":
        raise RuntimeError("Model declined to analyze this submission")

    text = next(b.text for b in response.content if b.type == "text")
    result = json.loads(text)

    return {
        "result": result,
        "model": settings.anthropic_model,
        "promptVersion": PROMPT_VERSION,
        "analyzedAt": datetime.now(timezone.utc).isoformat(),
    }
