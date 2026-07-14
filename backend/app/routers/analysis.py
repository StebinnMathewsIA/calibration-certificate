import anthropic
from fastapi import APIRouter, Body, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import audit
from ..auth import Identity, get_identity
from ..claude_analysis import analyze_calibration
from ..config import Settings, get_settings
from ..db import get_db
from ..notifier import MANAGER_NOTIFY_VERDICTS, default_notifier
from ..schema_validation import validate_calibration_form

router = APIRouter(prefix="/v1/analysis", tags=["analysis"])


@router.post("")
def analyze(
    payload: dict = Body(...),
    db: Session = Depends(get_db),
    identity: Identity = Depends(get_identity),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Runs the Claude review of a calibration BEFORE signing so the
    technician can react on-site. The verdict is advisory and is logged; the
    human signatory remains responsible."""
    if not settings.analysis_enabled:
        raise HTTPException(status_code=503, detail="Analysis is disabled")

    form = payload.get("form")
    if not isinstance(form, dict):
        raise HTTPException(status_code=422, detail="Body must be {'form': CalibrationForm}")
    violations = validate_calibration_form(form)
    if violations:
        raise HTTPException(status_code=422, detail={"violations": violations})

    try:
        response = analyze_calibration(form)
    except anthropic.RateLimitError as exc:
        raise HTTPException(status_code=429, detail="Analysis temporarily rate limited") from exc
    except anthropic.APIStatusError as exc:
        raise HTTPException(status_code=502, detail=f"Analysis upstream error ({exc.status_code})") from exc
    except anthropic.APIConnectionError as exc:
        raise HTTPException(status_code=502, detail="Analysis upstream unreachable") from exc

    cert_number = form["job"]["certificateNumber"]
    verdict = response["result"]["verdict"]
    audit.record(
        db,
        cert_number,
        audit.ANALYSIS_COMPLETED,
        identity.subject,
        {
            "verdict": verdict,
            "model": response["model"],
            "promptVersion": response["promptVersion"],
            "summary": response["result"]["summary"],
        },
    )
    if verdict in MANAGER_NOTIFY_VERDICTS:
        default_notifier.notify(cert_number, verdict, response["result"]["summary"])
        audit.record(db, cert_number, audit.MANAGER_NOTIFIED, "system", {"verdict": verdict})
    db.commit()
    return response
