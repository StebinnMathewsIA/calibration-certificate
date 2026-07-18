"""PAdES signing of technician-rendered certificate PDFs (pyHanko).

Flow (CLAUDE.md, "Signing flow"): the mobile app renders the PDF, the backend
verifies + cross-checks it, then applies a PAdES B-T signature with a visible
widget (technician name + signing date) and an RFC 3161 timestamp when a TSA
is configured. Keys come from a SigningKeyProvider (KMS in production).
"""
import hashlib
import io
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign import fields, signers, timestamps
from pyhanko.sign.fields import MDPPerm, SigFieldSpec, SigSeedSubFilter
from pyhanko.stamp import TextStampStyle

from .keys import SigningKeyProvider

SIGNATURE_FIELD = "ProwalcoSignature1"


@dataclass(frozen=True)
class SignResult:
    signed_pdf: bytes
    signed_pdf_sha256: str
    signature_id: str
    signed_at: datetime


class SigningService:
    def __init__(self, key_provider: SigningKeyProvider, tsa_url: str = ""):
        self._key_provider = key_provider
        self._timestamper = timestamps.HTTPTimeStamper(tsa_url) if tsa_url else None

    def sign_certificate_pdf(
        self,
        pdf_bytes: bytes,
        technician_name: str,
        certificate_number: str,
    ) -> SignResult:
        signer = self._key_provider.get_signer()
        signed_at = datetime.now(timezone.utc)
        signature_id = str(uuid.uuid4())

        writer = IncrementalPdfFileWriter(io.BytesIO(pdf_bytes))
        # Visible widget bottom-left of the FIRST page — the certificate face,
        # where the VO signature block sits (the Metrologist Note is page 2).
        fields.append_signature_field(
            writer,
            SigFieldSpec(sig_field_name=SIGNATURE_FIELD, on_page=0, box=(42, 40, 300, 90)),
        )

        meta = signers.PdfSignatureMetadata(
            field_name=SIGNATURE_FIELD,
            reason=f"Issue of calibration certificate {certificate_number}",
            location="Prowalco (Pty) Ltd",
            subfilter=SigSeedSubFilter.PADES,
            # Certification signature, no changes allowed: the document is
            # locked at issue and any later modification invalidates the
            # certification instead of showing as "changes after signing".
            certify=True,
            docmdp_permissions=MDPPerm.NO_CHANGES,
        )
        pdf_signer = signers.PdfSigner(
            meta,
            signer=signer,
            timestamper=self._timestamper,
            stamp_style=TextStampStyle(
                stamp_text=(
                    f"Digitally signed for {technician_name}\n"
                    "Date: %(ts)s\n"
                    f"Certificate: {certificate_number}"
                ),
            ),
        )
        out = pdf_signer.sign_pdf(writer)
        signed_pdf = out.getvalue()

        return SignResult(
            signed_pdf=signed_pdf,
            signed_pdf_sha256=hashlib.sha256(signed_pdf).hexdigest(),
            signature_id=signature_id,
            signed_at=signed_at,
        )
