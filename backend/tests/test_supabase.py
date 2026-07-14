"""Unit tests for the storage client's failure paths (mock transport — the
happy path against the real bucket is covered end-to-end in test_sign_flow)
and for Supabase JWT claim handling."""
import time

import httpx
import jwt
import pytest

from app.config import Settings, get_settings
from app.main import app
from app.pdf_store import PdfStoreError, SupabaseStoragePdfStore

FAKE_URL = "https://unittest.supabase.co"
JWT_SECRET = "unit-test-hs256-secret"


# ---------------------------------------------------------------------------
# Storage client behaviour (httpx.MockTransport — no network)
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
    store = SupabaseStoragePdfStore(FAKE_URL, "service-key", "certificates",
                                    client=_storage_client(objects))
    ref = store.put("PWC-JHB-000900-00", b"%PDF-fake")
    assert ref == "PWC-JHB-000900-00.pdf"
    assert store.get(ref) == b"%PDF-fake"


def test_storage_orphan_is_reclaimed_with_upsert():
    # Simulates the crash window: object uploaded, DB commit failed, retry.
    objects = {"PWC-JHB-000901-00.pdf": b"%PDF-orphan"}
    store = SupabaseStoragePdfStore(FAKE_URL, "service-key", "certificates",
                                    client=_storage_client(objects))
    ref = store.put("PWC-JHB-000901-00", b"%PDF-retry")
    assert store.get(ref) == b"%PDF-retry"


def test_storage_download_failure_raises():
    store = SupabaseStoragePdfStore(FAKE_URL, "service-key", "certificates",
                                    client=_storage_client({}))
    with pytest.raises(PdfStoreError):
        store.get("missing.pdf")


def test_storage_requires_configuration():
    with pytest.raises(PdfStoreError):
        SupabaseStoragePdfStore("", "", "certificates")


# ---------------------------------------------------------------------------
# Supabase JWT claim handling (legacy HS256 decode path — the JWKS path
# shares the same claim/provider logic; live JWKS verification is exercised
# by every authenticated test in the rest of the suite)
# ---------------------------------------------------------------------------


def _hs256_settings() -> Settings:
    return Settings(
        supabase_url=FAKE_URL,
        supabase_jwt_secret=JWT_SECRET,
        supabase_service_role_key="unit-test",
        database_url="postgresql+psycopg2://unit:test@localhost/unused",
    )


def _token(provider: str = "azure", **overrides) -> str:
    claims = {
        "sub": "8d9f0a1b-user-uuid",
        "aud": "authenticated",
        "iss": f"{FAKE_URL}/auth/v1",
        "exp": int(time.time()) + 3600,
        "email": "tech@prowalco.co.za",
        "app_metadata": {"provider": provider},
        "user_metadata": {"full_name": "T. Ngcobo"},
        **overrides,
    }
    return jwt.encode(claims, JWT_SECRET, algorithm="HS256")


@pytest.fixture()
def hs256_client(raw_client):
    app.dependency_overrides[get_settings] = _hs256_settings
    yield raw_client
    app.dependency_overrides.pop(get_settings, None)


def test_valid_hs256_token_accepted(hs256_client):
    resp = hs256_client.get(
        "/v1/certificates/PWC-ZZZ-999999-00/receipt",
        headers={"Authorization": f"Bearer {_token()}"},
    )
    assert resp.status_code == 404  # auth passed; certificate genuinely unknown


def test_missing_or_invalid_token_rejected(hs256_client):
    assert hs256_client.get("/v1/certificates/X/receipt").status_code == 401
    resp = hs256_client.get(
        "/v1/certificates/X/receipt",
        headers={"Authorization": f"Bearer {_token()}x"},
    )
    assert resp.status_code == 401


def test_wrong_issuer_rejected(hs256_client):
    bad = _token(iss="https://evil.example/auth/v1")
    resp = hs256_client.get(
        "/v1/certificates/X/receipt", headers={"Authorization": f"Bearer {bad}"}
    )
    assert resp.status_code == 401


def test_unpermitted_provider_rejected(hs256_client):
    # e.g. plain email/password sign-ups are not an allowed technician IdP
    resp = hs256_client.get(
        "/v1/certificates/X/receipt",
        headers={"Authorization": f"Bearer {_token(provider='email')}"},
    )
    assert resp.status_code == 403


def test_unauthenticated_request_rejected_live(raw_client):
    """Against the real project config: no token, no access."""
    assert raw_client.get("/v1/certificates/X/receipt").status_code == 401
