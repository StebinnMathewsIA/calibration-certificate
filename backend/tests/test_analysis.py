import uuid

from sqlalchemy import select

from app import audit
from app.db import SessionLocal
from app.models import AuditEvent
from app.routers import analysis as analysis_router
from tests.conftest import make_valid_form


def _canned_response(verdict: str) -> dict:
    return {
        "result": {
            "verdict": verdict,
            "summary": "Canned verdict for tests.",
            "concerns": [],
            "recommendations": [],
        },
        "model": "claude-opus-4-8",
        "promptVersion": "calibration-analysis-v1",
        "analyzedAt": "2026-07-14T09:00:00+00:00",
    }


def _form():
    n = f"PWC-DBN-{uuid.uuid4().int % 1_000_000:06d}-00"
    form = make_valid_form(cert_number=n)
    return form, n


def test_analysis_returns_verdict_and_audits(client, monkeypatch):
    form, cert_number = _form()
    monkeypatch.setattr(analysis_router, "analyze_calibration", lambda f: _canned_response("pass"))
    resp = client.post("/v1/analysis", json={"form": form})
    assert resp.status_code == 200
    assert resp.json()["result"]["verdict"] == "pass"

    with SessionLocal() as db:
        events = db.scalars(
            select(AuditEvent).where(AuditEvent.certificate_number == cert_number)
        ).all()
    types = [e.event_type for e in events]
    assert audit.ANALYSIS_COMPLETED in types
    assert audit.MANAGER_NOTIFIED not in types  # clean pass: no escalation


def test_fail_verdict_notifies_manager(client, monkeypatch):
    form, cert_number = _form()
    monkeypatch.setattr(analysis_router, "analyze_calibration", lambda f: _canned_response("fail"))
    resp = client.post("/v1/analysis", json={"form": form})
    assert resp.status_code == 200

    with SessionLocal() as db:
        events = db.scalars(
            select(AuditEvent).where(AuditEvent.certificate_number == cert_number)
        ).all()
    types = [e.event_type for e in events]
    assert audit.MANAGER_NOTIFIED in types
    completed = next(e for e in events if e.event_type == audit.ANALYSIS_COMPLETED)
    assert completed.payload["model"] == "claude-opus-4-8"
    assert completed.payload["promptVersion"] == "calibration-analysis-v1"


def test_invalid_form_rejected_before_calling_claude(client, monkeypatch):
    called = []
    monkeypatch.setattr(
        analysis_router, "analyze_calibration", lambda f: called.append(1) or _canned_response("pass")
    )
    form, _ = _form()
    del form["results"]
    resp = client.post("/v1/analysis", json={"form": form})
    assert resp.status_code == 422
    assert called == []
