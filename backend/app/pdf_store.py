"""Signed-PDF storage.

PDF_STORAGE=db        — PDF bytes live in the certificates table (dev/tests).
PDF_STORAGE=supabase  — PDF bytes live in a private Supabase Storage bucket;
                        the table keeps only the storage path + SHA-256.

The bucket must be PRIVATE. Uploads use x-upsert:false so an existing object
can never be silently overwritten — combined with the SHA-256 recorded in the
append-only audit trail this approximates write-once storage. Keep bucket
update/delete disallowed for every key except the service role
(docs/supabase-setup.md).
"""
from typing import Protocol

import httpx
from fastapi import Depends

from .config import Settings, get_settings


class PdfStoreError(RuntimeError):
    pass


class PdfStore(Protocol):
    def put(self, certificate_number: str, data: bytes) -> str | None:
        """Persist the signed PDF. Returns a storage ref, or None when the
        bytes should be kept in the DB row instead."""
        ...

    def get(self, storage_ref: str) -> bytes: ...


class DbPdfStore:
    """Dev/test: the signed PDF stays in the certificates table."""

    def put(self, certificate_number: str, data: bytes) -> str | None:
        return None

    def get(self, storage_ref: str) -> bytes:
        raise PdfStoreError("DbPdfStore has no external storage")


class SupabaseStoragePdfStore:
    def __init__(self, url: str, service_role_key: str, bucket: str, client: httpx.Client | None = None):
        if not url or not service_role_key:
            raise PdfStoreError("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        self._base = f"{url.rstrip('/')}/storage/v1/object"
        self._bucket = bucket
        self._client = client or httpx.Client(
            timeout=30,
            headers={
                "Authorization": f"Bearer {service_role_key}",
                "apikey": service_role_key,
            },
        )

    def put(self, certificate_number: str, data: bytes) -> str:
        path = f"{certificate_number}.pdf"
        resp = self._client.post(
            f"{self._base}/{self._bucket}/{path}",
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
                f"{self._base}/{self._bucket}/{path}",
                content=data,
                headers={"Content-Type": "application/pdf", "x-upsert": "true"},
            )
        if resp.status_code not in (200, 201):
            raise PdfStoreError(
                f"Supabase Storage upload failed ({resp.status_code}): {resp.text[:300]}"
            )
        return path

    def get(self, storage_ref: str) -> bytes:
        resp = self._client.get(f"{self._base}/{self._bucket}/{storage_ref}")
        if resp.status_code != 200:
            raise PdfStoreError(
                f"Supabase Storage download failed ({resp.status_code}): {resp.text[:300]}"
            )
        return resp.content


def get_pdf_store(settings: Settings = Depends(get_settings)) -> PdfStore:
    if settings.pdf_storage == "db":
        return DbPdfStore()
    if settings.pdf_storage == "supabase":
        return SupabaseStoragePdfStore(
            settings.supabase_url,
            settings.supabase_service_role_key,
            settings.supabase_storage_bucket,
        )
    raise PdfStoreError(f"Unknown PDF_STORAGE: {settings.pdf_storage}")
