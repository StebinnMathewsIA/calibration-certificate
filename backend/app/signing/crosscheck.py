"""Cross-check of the client-rendered PDF against the submitted form JSON.

A compromised client must not be able to get arbitrary content signed: before
signing we extract the PDF text layer and require the load-bearing form
fields to be present. This is a containment check, not full rendering
verification — the signed artefact is the PDF the technician actually saw.
"""
import re

from pypdf import PdfReader
import io


def _normalise(text: str) -> str:
    return re.sub(r"\s+", " ", text)


def _number_variants(value: float) -> list[str]:
    # The mobile template renders volumes to 3 decimals and errors to 1/3
    # decimals; accept the common formattings so template tweaks don't break
    # signing spuriously.
    variants = {f"{value:.3f}", f"{value:.2f}", f"{value:.1f}"}
    if value == int(value):
        variants.add(str(int(value)))
    return list(variants)


def crosscheck_pdf(pdf_bytes: bytes, form: dict) -> list[str]:
    """Returns a list of mismatches (empty = PDF matches the form JSON)."""
    problems: list[str] = []
    try:
        reader = PdfReader(io.BytesIO(pdf_bytes))
        text = _normalise(" ".join(page.extract_text() or "" for page in reader.pages))
    except Exception as exc:  # noqa: BLE001 — any parse failure blocks signing
        return [f"PDF could not be parsed: {exc}"]

    required_strings = {
        "certificate number": form["job"]["certificateNumber"],
        "technician name": form["signOff"]["calibratedBy"]["name"],
        "customer name": form["job"]["customerName"],
        "UUT serial number": form["uut"]["serialNumber"],
    }
    for label, value in required_strings.items():
        if _normalise(value) not in text:
            problems.append(f"PDF text layer does not contain the {label} ({value!r})")

    def check_rows(rows: list[dict], table: str) -> None:
        for i, row in enumerate(rows):
            for field in ("indicatedVolumeL", "measuredVolumeL"):
                if not any(v in text for v in _number_variants(row[field])):
                    problems.append(
                        f"PDF text layer does not contain {table}[{i}].{field} = {row[field]}"
                    )

    check_rows(form["results"]["asFound"], "asFound")
    check_rows(form["results"].get("asLeft") or [], "asLeft")

    return problems
