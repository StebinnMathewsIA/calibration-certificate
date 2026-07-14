import base64
import time
import uuid

import httpx
import jwt
import pytest

from app.config import Settings, get_settings
from app.main import app
from app.pdf_store import PdfStoreError, SupabaseStoragePdfStore, get_pdf_store
from tests.conftest import make_submission, make_valid_form

SUPABASE_URL = "https://testproj.supabase.co"
JWT_SECRET = "super-secret-legacy-hs256"


# ---------------------------------------------------------------------------
# Storage store (httpx.MockTransport — no network)
# ---------------------------------------------------------------------------


def _storage_client(objects: dict[str, bytes]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/storage/v1/object/certificates/")
        if request.method == "POST":
            if path in objects and request.headers.get("x-upsert") != "true":
                return httpx.Response(409, json={"error": "Duplicate"})
            objects[path] = request.content
            return httpx.Response(200, json={"Key": f"certificates/{path}"})
        if request.method == "GET":
            if path not in objects:
                return httpx.Response(404, json={"error": "not_found"})
            return httpx.Response(200, content=objects[path])
        return httpx.Response(405)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_storage_put_and_get_roundtrip():
    objects: dict[str, bytes] = {}
    store = SupabaseStoragePdfStore(SUPABASE_URL, "service-key", "certificates",
                                    client=_storage_client(objects))
    ref = store.put("PWC-JHB-000900-00", b"%PDF-fake")
    assert ref == "PWC-JHB-000900-00.pdf"
    assert store.get(ref) == b"%PDF-fake"


def test_storage_orphan_is_reclaimed_with_upsert():
    # Simulates the crash window: object uploaded, DB commit failed, retry.
    objects = {"PWC-JHB-000901-00.pdf": b"%PDF-orphan"}
    store = SupabaseStoragePdfStore(SUPABASE_URL, "service-key", "certificates",
                                    client=_storage_client(objects))
    ref = store.put("PWC-JHB-000901-00", b"%PDF-retry")
    assert store.get(ref) == b"%PDF-retry"


def test_storage_download_failure_raises():
    store = SupabaseStoragePdfStore(SUPABASE_URL, "service-key", "certificates",
                                    client=_storage_client({}))
    with pytest.raises(PdfStoreError):
        store.get("missing.pdf")


def test_storage_requires_configuration():
    with pytest.raises(PdfStoreError):
        SupabaseStoragePdfStore("", "", "certificates")


# ---------------------------------------------------------------------------
# Supabase Auth (legacy HS256 path — JWKS path shares the same claim handling)
# ---------------------------------------------------------------------------


def _supabase_settings() -> Settings:
    return Settings(
        auth_mode="supabase",
        supabase_url=SUPABASE_URL,
        supabase_jwt_secret=JWT_SECRET,
    )


def _token(provider: str = "azure", **overrides) -> str:
    claims = {
        "sub": "8d9f0a1b-user-uuid",
        "aud": "authenticated",
        "iss": f"{SUPABASE_URL}/auth/v1",
        "exp": int(time.time()) + 3600,
        "email": "tech@prowalco.co.za",
        "app_metadata": {"provider": provider},
        "user_metadata": {"full_name": "T. Ngcobo"},
        **overrides,
    }
    return jwt.encode(claims, JWT_SECRET, algorithm="HS256")


@pytest.fixture()
def supabase_auth_client(client):
    app.dependency_overrides[get_settings] = _supabase_settings
    yield client
    app.dependency_overrides.pop(get_settings, None)


def test_valid_supabase_token_accepted(supabase_auth_client):
    resp = supabase_auth_client.get(
        "/v1/certificates/PWC-ZZZ-999999-00/receipt",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 404  # auth passed; certificate genuinely unknown


def test_missing_or_invalid_token_rejected(supabase_auth_client):
    assert supabase_auth_client.get("/v1/certificates/X/receipt").status_code == 401
    resp = supabase_auth_client.get(
        "/v1/certificates/X/receipt",
        headers={"Authorization": f"Bearer {_token()}x"},
    )
    assert resp.status_code == 401


def test_wrong_issuer_rejected(supabase_auth_client):
    bad = _token(iss="https://evil.example/auth/v1")
    resp = supabase_auth_client.get(
        "/v1/certificates/X/receipt", headers={"Authorization": f"Bearer {bad}"}
    )
    assert resp.status_code == 401


def test_unpermitted_provider_rejected(supabase_auth_client):
    # e.g. plain email/password sign-ups are not an allowed technician IdP
    resp = supabase_auth_client.get(
        "/v1/certificates/X/receipt",
        headers={"Authorization": f"Bearer {_token(provider='email')}"},
    )
    assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Sign flow with external PDF storage
# ---------------------------------------------------------------------------


def test_sign_flow_stores_pdf_in_bucket_and_replays(client):
    objects: dict[str, bytes] = {}
    store = SupabaseStoragePdfStore(SUPABASE_URL, "service-key", "certificates",
                                    client=_storage_client(objects))
    app.dependency_overrides[get_pdf_store] = lambda: store
    try:
        cert_number = f"PWC-JHB-{uuid.uuid4().int % 1_000_000:06d}-00"
        sub = make_submission(make_valid_form(cert_number=cert_number))

        first = client.post("/v1/certificates/sign", json=sub)
        assert first.status_code == 200, first.text
        assert f"{cert_number}.pdf" in objects  # PDF landed in the bucket
        signed = base64.b64decode(first.json()["signedPdfBase64"])
        assert objects[f"{cert_number}.pdf"] == signed

        # Idempotent replay serves the SAME bytes back from the bucket.
        second = client.post("/v1/certificates/sign", json=sub)
        assert second.status_code == 200
        assert second.json()["signedPdfBase64"] == first.json()["signedPdfBase64"]
        assert len(objects) == 1
    finally:
        app.dependency_overrides.pop(get_pdf_store, None)
