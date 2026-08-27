#!/usr/bin/env python3
"""
Real-network verification script for the Doctavian integration.

Run this locally (NOT in Claude's sandbox — it cannot reach
demo.api.doctavian.com). This is the confirmatory regression test for
Phase 2's document generation, using Doctavian's CONFIRMED templating
syntax (Kanwal, 2026-08-26): plain-text {!fieldname} merge fields and
mdoc:paragraph elements with a "hidden" expression for conditional
blocks — see template_builder.py's module docstring for the full
syntax reference and how this was determined (native Word MERGEFIELD/IF
field codes were tried first and conclusively do not work, regardless
of the data supplied — see PROJECT_STATUS.md's Phase 2 section for that
investigation's full history).

Usage:
    export DOCTAVIAN_API_KEY=edff22dbcc244bd0b709d7e632ce12e5
    export DOCTAVIAN_API_BASE_URL=https://demo.api.doctavian.com
    export DOCTAVIAN_ACCESS_TOKEN=<paste from Postman's "Get New Access Token">

    python scripts/verify_doctavian_template.py docs/templates/tegata-warrant.docx

Make sure docs/templates/tegata-warrant.docx is up to date with the
current template_builder.py before running this — regenerate it with:

    python -c "from tegata_agent.template_builder import build_tegata_template; \\
        build_tegata_template('docs/templates/tegata-warrant.docx')"

    (run from apps/agent/src on your PYTHONPATH, or adjust sys.path)

What this script does — fully automated, no Postman needed:
    0. Uploads the .docx to Doctavian's Storage as a template.
    1. Uploads a data file with real flat key/value data under the
       top-level "data" key (e.g. {"data": {"resource": ...,
       "required_approver_count": "2", ...}}) — the wrapper key itself
       was Kanwal's 2026-08-25 fix for TEMPLATE_READ_FAILED, and is
       required regardless of templating approach.
    2. Generates TWO documents (high risk / low risk) from the same
       template.
    3. Downloads both automatically (via
       DoctavianClient.download_document(), endpoint confirmed from the
       real Postman collection's "Step 6 — Download the document"
       request) and extracts their text with python-docx.
    4. Prints a clear PASS/FAIL diagnosis:
       - PASS: merge fields show real values AND the two documents'
         approval clause genuinely differs ("TWO approvers" vs "ONE
         approver") -> Phase 2's conditional document generation is
         confirmed working end-to-end.
       - FAIL: something has drifted from the confirmed-working syntax
         (e.g. a template_builder.py edit introduced a typo in an
         expression, or Doctavian's engine behavior changed) — compare
         the downloaded text against template_builder.py's docstring
         and Kanwal's reference files in docs/doctavian-samples/.
"""
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

# Robust to being run from anywhere (repo root or apps/agent) — resolves
# relative to this script's own location, not the caller's cwd.
_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
sys.path.insert(0, str(_AGENT_SRC))

from docx import Document  # noqa: E402
from tegata_agent.doctavian_client import DoctavianClient, DoctavianConfig, TemplateVariable  # noqa: E402


def _extract_text(docx_bytes: bytes) -> str:
    """Writes downloaded bytes to a temp .docx and reads its paragraph
    text back out via python-docx, so we can compare rendered content
    programmatically instead of requiring a human to open the file."""
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp.write(docx_bytes)
        tmp_path = Path(tmp.name)
    try:
        doc = Document(tmp_path)
        return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
    finally:
        tmp_path.unlink(missing_ok=True)


def _generate_and_download(client: DoctavianClient, docx_path: Path, label: str, fields: dict) -> str:
    """Uploads a fresh template + a data file containing `fields` (real
    key/value pairs, not empty), generates, downloads, and returns the
    resulting document's extracted text."""
    uploaded_template = client.upload_template(docx_path)
    template_urn = uploaded_template["id"]

    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        json.dump({"data": fields}, tmp)
        data_path = Path(tmp.name)
    try:
        uploaded_data = client.upload_data(data_path)
    finally:
        data_path.unlink(missing_ok=True)
    data_urn = uploaded_data["id"]

    print(f"  [{label}] template_urn={template_urn}  data_urn={data_urn}")

    generated = client.generate_document(
        template_name="Tegata Warrant (verification)",
        template_urn=template_urn,
        document_name=f"verify-{label}-{uuid.uuid4().hex[:8]}",
        variables=[TemplateVariable(name=k, value=v) for k, v in fields.items()],
        external_request_id=f"verify-{label}-{uuid.uuid4().hex[:8]}",
        data_urn=data_urn,
    )
    document_id = generated["urn"]
    print(f"  [{label}] generated, document_id={document_id}")

    docx_bytes = client.download_document(document_id)
    print(f"  [{label}] downloaded {len(docx_bytes)} bytes")

    return _extract_text(docx_bytes)


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/verify_doctavian_template.py <path-to-local-docx>")
        sys.exit(1)

    docx_path = Path(sys.argv[1])
    if not docx_path.exists():
        print(f"Error: file not found: {docx_path}")
        sys.exit(1)

    api_key = os.environ.get("DOCTAVIAN_API_KEY")
    access_token = os.environ.get("DOCTAVIAN_ACCESS_TOKEN")
    base_url = os.environ.get("DOCTAVIAN_API_BASE_URL", "https://demo.api.doctavian.com")
    if not api_key:
        print("Error: set DOCTAVIAN_API_KEY first.")
        sys.exit(1)
    if not access_token:
        print(
            "Error: set DOCTAVIAN_ACCESS_TOKEN first "
            "(get one via Postman's 'Get New Access Token' button)."
        )
        sys.exit(1)

    client = DoctavianClient(
        DoctavianConfig(api_key=api_key, base_url=base_url, access_token=access_token)
    )

    print("Step 1: HIGH-risk document (required_approver_count=2)...")
    high_text = _generate_and_download(
        client,
        docx_path,
        "high",
        {
            "resource": "db_payment_prod",
            "requested_by": "verify-script",
            "reason": "verification run",
            "requested_duration_minutes": "1440",
            "max_duration_minutes": "60",
            "risk_score": "92",
            "risk_tier": "high",
            "required_approver_count": "2",
        },
    )

    print("\nStep 2: LOW-risk document (required_approver_count=1)...")
    low_text = _generate_and_download(
        client,
        docx_path,
        "low",
        {
            "resource": "internal_wiki",
            "requested_by": "verify-script",
            "reason": "verification run",
            "requested_duration_minutes": "15",
            "max_duration_minutes": "15",
            "risk_score": "10",
            "risk_tier": "low",
            "required_approver_count": "1",
        },
    )

    print("\n" + "=" * 70)
    print("HIGH-risk document text:")
    print(high_text)
    print("\nLOW-risk document text:")
    print(low_text)
    print("=" * 70)

    fields_substituted = "db_payment_prod" in high_text and "internal_wiki" in low_text
    clause_differs = ("TWO approver" in high_text) and ("ONE approver" in low_text)

    print("\nDIAGNOSIS:")
    print(f"  Merge fields substituted with real values: {'YES' if fields_substituted else 'NO'}")
    print(f"  Approval clause genuinely differs (TWO vs ONE): {'YES' if clause_differs else 'NO'}")

    if fields_substituted and clause_differs:
        print(
            "\nPASS — Phase 2 confirmed working end-to-end: merge fields "
            "substitute correctly and the approval clause genuinely "
            "differs by risk tier. Update PROJECT_STATUS.md to mark "
            "Phase 2 fully resolved."
        )
    else:
        print(
            "\nFAIL — something has drifted from the confirmed-working "
            "syntax. Compare template_builder.py against its own module "
            "docstring (the confirmed Doctavian syntax reference) and "
            "against Kanwal's reference files in docs/doctavian-samples/. "
            "Make sure docs/templates/tegata-warrant.docx was regenerated "
            "after any template_builder.py change — see this script's "
            "module docstring for the regeneration command."
        )


if __name__ == "__main__":
    main()
