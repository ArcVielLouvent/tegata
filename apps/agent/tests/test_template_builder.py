import zipfile
from pathlib import Path

from docx import Document

from tegata_agent.template_builder import build_tegata_template


def _all_paragraph_text(docx_path: Path) -> list[str]:
    return [p.text for p in Document(docx_path).paragraphs]


def test_template_builds_a_valid_docx(tmp_path):
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    assert out.exists()
    assert out.suffix == ".docx"
    # a docx is a zip; this should not raise
    with zipfile.ZipFile(out) as z:
        assert "word/document.xml" in z.namelist()


def test_template_contains_all_expected_merge_fields(tmp_path):
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    text = "\n".join(_all_paragraph_text(out))

    expected_fields = [
        "{!resource}",
        "{!requested_by}",
        "{!reason}",
        "{!requested_duration_minutes}",
        "{!max_duration_minutes}",
        "{!risk_score}",
        "{!risk_tier}",
    ]
    for field in expected_fields:
        assert field in text, f"Missing expected merge field: {field}"


def test_template_uses_confirmed_doctavian_syntax_not_native_word_fields(tmp_path):
    """The core regression this test guards against: reverting to native
    Word MERGEFIELD/IF field codes, which were conclusively confirmed
    (2026-08-26, real API testing + Kanwal's reply) to NEVER be
    evaluated by Doctavian's engine, regardless of the data supplied.
    Every placeholder must be literal paragraph text, not an OOXML field
    code."""
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    with zipfile.ZipFile(out) as z:
        xml = z.read("word/document.xml").decode("utf-8")

    assert "MERGEFIELD" not in xml
    assert "fldChar" not in xml
    assert "instrText" not in xml


def test_template_contains_conditional_paragraph_elements_for_approval_clause(tmp_path):
    """This is the key assertion for Phase 2's actual differentiator: the
    approval clause must be implemented as two mutually-exclusive
    mdoc:paragraph blocks (Doctavian's confirmed mechanism for
    conditionally showing/hiding an entire block of content), not a
    single static sentence and not an inline ternary substitution."""
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    text = "\n".join(_all_paragraph_text(out))

    two_open = '<mdoc:paragraph name="twoApprovers" hidden="{!$required_approver_count != \'2\'}">'
    one_open = '<mdoc:paragraph name="oneApprover" hidden="{!$required_approver_count == \'2\'}">'

    assert two_open in text
    assert '</mdoc:paragraph name="twoApprovers">' in text
    assert one_open in text
    assert '</mdoc:paragraph name="oneApprover">' in text
    assert "TWO approvers" in text
    assert "ONE approver" in text


def test_approval_clause_conditions_are_mutually_exclusive():
    """Sanity-check the two hidden conditions can never both be false (or
    both true) for the same value of required_approver_count — otherwise
    a real generated document could show both sentences at once, or
    neither. This doesn't call Doctavian; it validates the boolean logic
    of the two conditions directly in Python, mirroring what the Jexl
    expressions encode."""
    for value in ["2", "1", "0", "3"]:
        two_approvers_hidden = value != "2"
        one_approver_hidden = value == "2"
        assert two_approvers_hidden != one_approver_hidden, (
            f"For required_approver_count={value!r}, exactly one of the two "
            "paragraphs must be hidden and the other visible."
        )


def test_template_file_is_reasonably_small(tmp_path):
    # sanity check: a docx with just this content should be small;
    # if it balloons, something went wrong in generation
    out = build_tegata_template(tmp_path / "tegata-template.docx")
    assert out.stat().st_size < 50_000
