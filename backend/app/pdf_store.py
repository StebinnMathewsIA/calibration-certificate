"""Signed-PDF storage: a private Supabase Storage bucket. The certificates
table keeps only the object path + SHA-256.

The bucket must be PRIVATE. Uploads use x-upsert:false so an existing object
can never be silently overwritten — combined with the SHA-256 recorded in the
append-only audit trail this approximates write-once storage.
"""
from functools import lru_cache

import httpx
from fastapi import Depends

from .config import Settings, get_settings


class PdfStoreError(RuntimeError):
    pass


class SupabaseStoragePdfStore:
    def __init__(self, url: str, service_role_key: str, bucket: str, client: httpx.Client | None = None):
        if not url or not service_role_key:
            raise PdfStoreError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self._storage = f"{url.rstrip('/')}/storage/v1"
        self._objects = f"{self._storage}/object"
        self._bucket = bucket
        self._client = client or httpx.Client(
            timeout=30,
            headers={
                "Authorization": f"Bearer {service_role_key}",
                "apikey": service_role_key,
            },
        )

    def ensure_bucket(self) -> None:
        """Creates the private bucket if it does not exist (startup + tests)."""
        resp = self._client.get(f"{self._storage}/bucket/{self._bucket}")
        if resp.status_code == 200:
            return
        resp = self._client.post(
            f"{self._storage}/bucket",
            json={"id": self._bucket, "name": self._bucket, "public": False},
        )
        if resp.status_code not in (200, 201):
            raise PdfStoreError(
                f"Could not create bucket {self._bucket!r} ({resp.status_code}): {resp.text[:300]}"
            )

    def put(self, certificate_number: str, data: bytes) -> str:
        path = f"{certificate_number}.pdf"
        resp = self._client.post(
            f"{self._objects}/{self._bucket}/{path}",
            content=data,
            headers={"Content-Type": "application/pdf", "x-upsert": "false"},
        )
        if resp.status_code == 409:
            # An object already exists at this path. That can only be an
            # orphan from an upload whose DB commit failed: once a certificate
            # row is committed, the idempotency check returns the stored
            # result before put() is ever called again, and certificate
            # numbers are unique. Reclaim the orphan with an explicit upsert.
            resp = self._client.post(
                f"{self._objects}/{self._bucket}/{path}",
                content=data,
                headers={"Content-Type": "application/pdf", "x-upsert": "true"},
            )
        if resp.status_code not in (200, 201):
            raise PdfStoreError(
                f"Supabase Storage upload failed ({resp.status_code}): {resp.text[:300]}"
            )
        return path

    def get(self, storage_ref: str) -> bytes:
        resp = self._client.get(f"{self._objects}/{self._bucket}/{storage_ref}")
        if resp.status_code != 200:
            raise PdfStoreError(
                f"Supabase Storage download failed ({resp.status_code}): {resp.text[:300]}"
            )
        return resp.content


# Alias kept for typing clarity in the routers
PdfStore = SupabaseStoragePdfStore


@lru_cache
def _store(url: str, key: str, bucket: str) -> SupabaseStoragePdfStore:
    return SupabaseStoragePdfStore(url, key, bucket)


def get_pdf_store(settings: Settings = Depends(get_settings)) -> SupabaseStoragePdfStore:
    return _store(
        settings.supabase_url,
        settings.supabase_service_role_key,
        settings.supabase_storage_bucket,
    )
