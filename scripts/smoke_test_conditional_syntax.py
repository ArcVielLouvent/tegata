#!/usr/bin/env python3
"""
Exploratory script — tests several CANDIDATE syntaxes for conditional /
branching logic inside Doctavian's plain-text expression templating
(confirmed 2026-08-26 via smoke_test_expression_syntax.py: Doctavian
reads plain-text "{!fieldname}" placeholders from the uploaded data
file's flat keys, and does NOT evaluate native Word MERGEFIELD/IF field
codes at all, regardless of whether real or empty data is supplied).

What's still unknown: the syntax for a CONDITIONAL expression (Tegata's
actual differentiator — the approval clause must read differently for
high vs low risk, not just substitute a flat value). We have no
documentation for this (their "Elements Reference" page is JS-rendered
and inaccessible to Claude's sandbox), so this script tries several
plausible candidates in ONE template/generate/download round-trip,
each in its own clearly-labeled paragraph, so a single run tells us
which (if any) actually got evaluated instead of passed through as
literal text.

Candidates tested (labelled A-D in the output):
    A. IF(...) function call, double-equals, Word-IF-like quoting:
       {!IF(required_approver_count == "2", "TWO approvers", "ONE approver")}
    B. IF(...) function call, single-equals (mirrors native Word IF
       field's own "=" comparison operator, just moved inside {!...}):
       {!IF(required_approver_count = "2", "TWO approvers", "ONE approver")}
    C. Handlebars-style block helper:
       {{#if required_approver_count == "2"}}TWO approvers{{else}}ONE approver{{/if}}
    D. Ternary expression (common in JS/GraphQL-like expression languages,
       and Doctavian's own docs reference "fieldExpression" variables
       resembling GraphQL):
       {!required_approver_count == "2" ? "TWO approvers" : "ONE approver"}

Usage:
    export DOCTAVIAN_API_KEY=...
    export DOCTAVIAN_ACCESS_TOKEN=...
    python scripts/smoke_test_conditional_syntax.py

If NONE of these evaluate correctly, stop guessing — reply to Kanwal's
thread with this exact question: "we've confirmed {!fieldname} plain-text
substitution works from the data file, but need the syntax for
conditional/branching content (e.g. show different text depending on
whether a field equals a given value) — what's the correct syntax?"
"""
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

from docx import Document

_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
sys.path.insert(0, str(_AGENT_SRC))

from tegata_agent.doctavian_client import DoctavianClient, DoctavianConfig  # noqa: E402

CANDIDATES = {
    "A (IF, ==)": 'A: {!IF(required_approver_count == "2", "TWO approvers", "ONE approver")}',
    "B (IF, =)": 'B: {!IF(required_approver_count = "2", "TWO approvers", "ONE approver")}',
    "C (Handlebars)": 'C: {{#if required_approver_count == "2"}}TWO approvers{{else}}ONE approver{{/if}}',
    "D (ternary)": 'D: {!required_approver_count == "2" ? "TWO approvers" : "ONE approver"}',
}


def main():
    api_key = os.environ.get("DOCTAVIAN_API_KEY")
    access_token = os.environ.get("DOCTAVIAN_ACCESS_TOKEN")
    base_url = os.environ.get("DOCTAVIAN_API_BASE_URL", "https://demo.api.doctavian.com")
    if not api_key or not access_token:
        print("Error: set DOCTAVIAN_API_KEY and DOCTAVIAN_ACCESS_TOKEN first.")
        sys.exit(1)

    client = DoctavianClient(
        DoctavianConfig(api_key=api_key, base_url=base_url, access_token=access_token)
    )

    doc = Document()
    doc.add_paragraph("Conditional syntax candidates (required_approver_count = 2 in the data):")
    for label, text in CANDIDATES.items():
        doc.add_paragraph(text)
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp_docx_path = Path(tmp.name)
    doc.save(tmp_docx_path)
    print(f"Built candidate-testing template at {tmp_docx_path}")

    print("\nUploading template...")
    uploaded_template = client.upload_template(tmp_docx_path)
    print(f"  {uploaded_template}")

    print("\nUploading data (required_approver_count = 2, so all four candidates")
    print("should render 'TWO approvers' if their syntax is the correct one)...")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        json.dump({"data": {"required_approver_count": "2"}}, tmp)
        tmp_data_path = Path(tmp.name)
    uploaded_data = client.upload_data(tmp_data_path)
    print(f"  {uploaded_data}")

    print("\nGenerating...")
    try:
        result = client.generate_document(
            template_name="smoke-test-conditional-syntax",
            template_urn=uploaded_template["id"],
            document_name=f"smoke-conditional-{uuid.uuid4().hex[:8]}",
            variables=[],
            external_request_id=f"smoke-conditional-{uuid.uuid4().hex[:8]}",
            data_urn=uploaded_data["id"],
        )
        print(f"Generated: {result}")

        print("\nDownloading...")
        docx_bytes = client.download_document(result["urn"])
        with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
            tmp.write(docx_bytes)
            downloaded_path = Path(tmp.name)
        lines = [p.text for p in Document(downloaded_path).paragraphs if p.text.strip()]
        downloaded_path.unlink(missing_ok=True)

        print("\n" + "=" * 70)
        print("Downloaded document text:")
        for line in lines:
            print(f"  {line}")
        print("=" * 70)

        print("\nDIAGNOSIS (a candidate PASSED only if its line evaluated to")
        print("literally 'TWO approvers' with no leftover syntax characters):")
        any_passed = False
        for line in lines:
            if line.startswith(("A:", "B:", "C:", "D:")):
                label, content = line.split(":", 1)
                content = content.strip()
                if content == "TWO approvers":
                    print(f"  Candidate {label}: PASS — this is the correct syntax")
                    any_passed = True
                else:
                    print(f"  Candidate {label}: FAIL — rendered as: {content!r}")
        if not any_passed:
            print(
                "\nNone of the candidates evaluated correctly. Stop guessing here — "
                "reply to Kanwal's thread and ask directly for the conditional/"
                "branching expression syntax, now that plain-text {!field} "
                "substitution is confirmed working for flat values."
            )
    except Exception as e:
        print(f"\nFAILED (generate or download raised): {e}")

    tmp_docx_path.unlink(missing_ok=True)
    tmp_data_path.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
