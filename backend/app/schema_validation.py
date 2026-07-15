"""Re-validation of submissions against the shared schema contract.

The mobile app validates with zod; the backend validates the exact same
contract via the JSON Schema exported from those zod schemas
(shared/schema/json/*.schema.json). Structural rules (types, enums, regexes,
required fields) live there; cross-field rules that JSON Schema cannot
express (as-left consistency, standards expiry, recomputed results) live in
app/readiness.py.
"""
import json
from functools import lru_cache

from jsonschema import Draft7Validator

from .config import SHARED_SCHEMA_JSON_DIR


@lru_cache
def _validator(name: str) -> Draft7Validator:
    path = SHARED_SCHEMA_JSON_DIR / name
    schema = json.loads(path.read_text())
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def validate_against(name: str, payload: dict) -> list[str]:
    """Returns a list of human-readable violations (empty = valid)."""
    errors = sorted(_validator(name).iter_errors(payload), key=lambda e: list(e.absolute_path))
    out = []
    for e in errors:
        path = ".".join(str(p) for p in e.absolute_path) or "(root)"
        out.append(f"{path}: {e.message}")
    return out


def validate_sign_submission(payload: dict) -> list[str]:
    return validate_against("sign-submission.schema.json", payload)


def validate_verification(payload: dict) -> list[str]:
    return validate_against("verification.schema.json", payload)
