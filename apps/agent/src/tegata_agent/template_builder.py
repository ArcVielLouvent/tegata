"""
Tegata document template builder.

IMPORTANT ASSUMPTION (must be verified against the real Doctavian API
before Phase 2 is considered fully done): Doctavian's Document Generate
endpoint loads a real .docx file and merges data into it. We assume it
respects standard Word merge-field conditional logic (IF fields), since
their own API options mention "docxLoadOptions": {"PreserveUnsupportedFeatures": true}
which implies genuine docx structural features are read, not just a
custom bracket-tag syntax. We could not confirm the exact templating tag
language from their public docs (the linked "Elements Reference" guide
is a JS-rendered page we could not read).

This is why the approval clause below is built as a NATIVE WORD "IF"
merge field ({ IF { MERGEFIELD required_approver_count } = "2" "..." "..." }),
not a proprietary bracket syntax we'd be guessing at. Native Word fields
are testable independent of Doctavian (see tests/test_template_builder.py,
which verifies the generated .docx's XML structure directly).

FIRST THING TO DO once you have Doctavian API access in Codespace:
run scripts/verify_doctavian_template.py (Phase 2, not yet written) to
confirm the conditional actually renders differently for high vs low
risk. If it does NOT, this file's approach needs to change to whatever
tag syntax their engine actually expects.
"""
from __future__ import annotations

from pathlib import Path

from docx import Document
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def _add_field(paragraph, field_instruction: str) -> None:
    """Insert a raw Word field code into a paragraph run.
    e.g. field_instruction = 'MERGEFIELD required_approver_count'
    """
    run = paragraph.add_run()
    fld_char_begin = OxmlElement("w:fldChar")
    fld_char_begin.set(qn("w:fldCharType"), "begin")
    run._r.append(fld_char_begin)

    instr_text = OxmlElement("w:instrText")
    instr_text.set(qn("xml:space"), "preserve")
    instr_text.text = f" {field_instruction} "
    run._r.append(instr_text)

    fld_char_end = OxmlElement("w:fldChar")
    fld_char_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_char_end)


def build_tegata_template(output_path: str | Path) -> Path:
    """Builds the Tegata warrant .docx template with:
    - Plain MERGEFIELD placeholders for always-visible fields (resource,
      reason, requester, risk score, tier, duration).
    - A native Word IF field that renders a different approval clause
      depending on required_approver_count (the "branching" the Doctavian
      challenge asks for).

    Returns the path written.
    """
    output_path = Path(output_path)
    doc = Document()

    doc.add_heading("Tegata — Access Authorization Warrant", level=1)

    p = doc.add_paragraph("Resource: ")
    _add_field(p, "MERGEFIELD resource")

    p = doc.add_paragraph("Requested by: ")
    _add_field(p, "MERGEFIELD requested_by")

    p = doc.add_paragraph("Reason: ")
    _add_field(p, "MERGEFIELD reason")

    p = doc.add_paragraph("Requested duration (minutes): ")
    _add_field(p, "MERGEFIELD requested_duration_minutes")

    p = doc.add_paragraph("Approved maximum duration (minutes): ")
    _add_field(p, "MERGEFIELD max_duration_minutes")

    p = doc.add_paragraph("Risk score: ")
    _add_field(p, "MERGEFIELD risk_score")
    p.add_run(" / 100 (tier: ")
    _add_field(p, "MERGEFIELD risk_tier")
    p.add_run(")")

    doc.add_heading("Approval Requirement", level=2)

    # Native Word conditional field:
    # { IF { MERGEFIELD required_approver_count } = "2"
    #     "This request requires signatures from TWO approvers before it is valid."
    #     "This request requires a signature from ONE approver before it is valid." }
    p = doc.add_paragraph()
    run = p.add_run()
    fld_begin = OxmlElement("w:fldChar")
    fld_begin.set(qn("w:fldCharType"), "begin")
    run._r.append(fld_begin)

    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = (
        ' IF { MERGEFIELD required_approver_count } = "2" '
        '"This request requires signatures from TWO approvers before it is valid." '
        '"This request requires a signature from ONE approver before it is valid." '
    )
    run._r.append(instr)

    fld_end = OxmlElement("w:fldChar")
    fld_end.set(qn("w:fldCharType"), "end")
    run._r.append(fld_end)

    doc.add_paragraph(
        "This document is void if not signed within the approval window, "
        "and access is automatically revoked when the approved duration expires."
    )

    doc.save(output_path)
    return output_path
