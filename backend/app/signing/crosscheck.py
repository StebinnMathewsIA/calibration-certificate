"""Cross-check of the client-rendered PDF against the submitted verification JSON.

A compromised client must not be able to get arbitrary content signed: before
signing we extract the PDF text layer and require the load-bearing fields to be
present. This is a containment check, not full rendering verification — the
signed artefact is the PDF the technician actually saw.
"""
import re

from pypdf import PdfReader
import io


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _number_variants(value: float) -> list[str]:
    # Accept the common numeric formattings so template tweaks don't break
    # signing spuriously.
    variants = {f"{value:.3f}", f"{value:.2f}", f"{value:.1f}", f"{value:.0f}"}
    if value == int(value):
        variants.add(str(int(value)))
    return list(variants)


def crosscheck_pdf(pdf_bytes: bytes, verification: dict) -> list[str]:
    """Returns a list of mismatches (empty = PDF matches the verification JSON)."""
    problems: list[str] = []
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = _normalise(" ".join(page.extract_text() or "" for page in reader.pages))
    except Exception as exc:  # noqa: BLE001 — any parse failure blocks signing
        return [f"PDF could not be parsed: {exc}"]

    required_strings = {
        "certificate number": verification["certificateNumber"],
        "VO name": verification["signOff"]["vo"]["identity"]["name"],
        "customer name": verification["site"]["customerName"],
        "dispenser serial number": verification["dispenser"]["serialNumber"],
    }
    for label, value in required_strings.items():
        if _normalise(str(value)) not in text:
            problems.append(f"PDF text layer does not contain the {label} ({value!r})")

    for hi, hose in enumerate(verification["hoses"]):
        for di, d in enumerate(hose["deliveries"]):
            for field in ("vfdMl", "vrefMl"):
                if not any(v in text for v in _number_variants(d[field])):
                    problems.append(
                        f"PDF text layer does not contain hoses[{hi}].deliveries[{di}]."
                        f"{field} = {d[field]}"
                    )

    return problems
