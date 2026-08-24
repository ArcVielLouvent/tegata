"""
Minimal PDF generator for testing the Foxit eSign integration.

Unlike Doctavian (where we embed conditional logic INTO the document via
Word fields), Foxit's signature/text fields are positioned by explicit
x/y/width/height coordinates passed in the API call itself (see
foxit_client.SignatureField) — the PDF content itself can be simple,
plain text. No special tags or embedded fields needed in the file.
"""
from __future__ import annotations

from pathlib import Path

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


def build_test_warrant_pdf(output_path: str | Path) -> Path:
    output_path = Path(output_path)
    c = canvas.Canvas(str(output_path), pagesize=letter)
    width, height = letter

    c.setFont("Helvetica-Bold", 16)
    c.drawString(72, height - 72, "Tegata — Access Authorization Warrant")

    c.setFont("Helvetica", 11)
    lines = [
        "Resource: db_payment_prod",
        "Requested by: verify-script",
        "Reason: verification run",
        "Risk score: 92 / 100 (tier: high)",
        "",
        "This request requires TWO approver signatures before it is valid.",
        "Access is automatically revoked when the approved duration expires.",
    ]
    y = height - 120
    for line in lines:
        c.drawString(72, y, line)
        y -= 20

    c.save()
    return output_path
