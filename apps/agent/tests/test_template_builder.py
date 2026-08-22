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
    # both fldChar begin/end markers must be present for a well-formed field
    assert xml.count('w:fldCharType="begin"') >= 2  # at least one MERGEFIELD + the IF field
    assert xml.count('w:fldCharType="end"') >= 2


def test_template_file_is_reasonably_small(tmp_path):
    # sanity check: a docx with just this content should be small;
    # if it balloons, something went wrong in generation
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    assert out.stat().st_size < 50_000
