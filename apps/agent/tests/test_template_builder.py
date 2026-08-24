import zipfile
from pathlib import Path

from tegata_agent.template_builder import build_tegata_template


def _read_document_xml(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path) as z:
        with z.open("word/document.xml") as f:
            return f.read().decode("utf-8")


def test_template_builds_a_valid_docx(tmp_path):
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    assert out.exists()
    assert out.suffix == ".docx"
    # a docx is a zip; this should not raise
    with zipfile.ZipFile(out) as z:
        assert "word/document.xml" in z.namelist()


def test_template_contains_all_expected_mergefields(tmp_path):
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    xml = _read_document_xml(out)

    expected_fields = [
        "MERGEFIELD resource",
        "MERGEFIELD requested_by",
        "MERGEFIELD reason",
        "MERGEFIELD requested_duration_minutes",
        "MERGEFIELD max_duration_minutes",
        "MERGEFIELD risk_score",
        "MERGEFIELD risk_tier",
    ]
    for field in expected_fields:
        assert field in xml, f"Missing expected field: {field}"


def test_template_contains_conditional_if_field_not_just_static_text(tmp_path):
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    xml = _read_document_xml(out)

    # This is the key assertion: it must be a real Word IF field (branching
    # logic evaluated at render time), not just both sentences dumped as
    # plain static text with no condition.
    assert "IF { MERGEFIELD required_approver_count }" in xml
    assert "TWO approvers" in xml
    assert "ONE approver" in xml
    # A structurally COMPLETE field needs begin, separate, AND end markers
    # (not just begin/end) — this was the actual bug that caused
    # Doctavian's real API to reject the file with TEMPLATE_READ_FAILED,
    # even though python-docx and Microsoft Word both tolerated the
    # incomplete version silently.
    assert xml.count('w:fldCharType="begin"') >= 2
    assert xml.count('w:fldCharType="separate"') >= 2
    assert xml.count('w:fldCharType="end"') >= 2


def test_all_fields_have_matching_begin_separate_end_counts(tmp_path):
    """Catches any future field added without the full 4-part structure —
    counts must always match exactly, never just 'begin >= 1'."""
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    xml = _read_document_xml(out)

    begins = xml.count('w:fldCharType="begin"')
    separates = xml.count('w:fldCharType="separate"')
    ends = xml.count('w:fldCharType="end"')

    assert begins == separates == ends, (
        f"Field structure mismatch: begin={begins} separate={separates} end={ends} "
        "— every field must have exactly one of each."
    )


def test_template_file_is_reasonably_small(tmp_path):
    # sanity check: a docx with just this content should be small;
    # if it balloons, something went wrong in generation
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    assert out.stat().st_size < 50_000
