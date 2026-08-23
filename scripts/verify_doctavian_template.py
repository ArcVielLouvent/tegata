#!/usr/bin/env python3
"""
Real-network verification script for the Doctavian integration.

Run this in your Codespace (NOT in Claude's sandbox — it cannot reach
demo.api.doctavian.com). This is the single most important thing to run
before considering Phase 2 "done", because it tests the one assumption
this whole phase rests on: that Doctavian's engine actually evaluates the
native Word IF field in our template as real conditional logic, not just
literal text.

Usage:
    export DOCTAVIAN_API_KEY=edff22dbcc244bd0b709d7e632ce12e5
    export DOCTAVIAN_API_BASE_URL=https://demo.api.doctavian.com
    export DOCTAVIAN_ACCESS_TOKEN=<paste from Postman's "Get New Access Token">

    python scripts/verify_doctavian_template.py docs/templates/tegata-warrant.docx

What this script does:
    0. Uploads the .docx to Doctavian's own Storage (POST
       /v1/documents/document/upload). This step exists because an
       external URL (e.g. GitHub raw) was confirmed via real testing to
       fail with 500 GET_FILE_FROM_STORAGE_FAILED — loadMethod="Storage"
       means the file bytes must actually live in Doctavian's storage,
       the url/path fields are not a fetchable external reference.
    1. Registers the template via create_template(), using the storage id
       from step 0.
    2. Generates TWO documents from it: one with required_approver_count=2,
       one with required_approver_count=1.
    3. Tells you what to check manually: open both generated documents and
       confirm the approval clause text is actually different.
    4. If they're NOT different, the native-Word-IF-field assumption in
       template_builder.py is WRONG and needs to be replaced with
       whatever tag syntax Doctavian's support team says to use instead.
"""
import os
import sys
import uuid
from pathlib import Path

# Robust to being run from anywhere (repo root or apps/agent) — resolves
# relative to this script's own location, not the caller's cwd.
_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
sys.path.insert(0, str(_AGENT_SRC))

from tegata_agent.doctavian_client import DoctavianClient, DoctavianConfig, TemplateVariable  # noqa: E402


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

    print(f"Step 0: uploading {docx_path.name} as a template...")
    print("(using upload_template(), NOT upload_document()+create_template() —")
    print(" confirmed via Doctavian's own quickstart missions that this")
    print(" returns an id usable directly as generate_document's template_urn)")
    uploaded = client.upload_template(docx_path)
    print(f"  Uploaded: {uploaded}")
    template_urn = uploaded["id"]

    print("\nStep 1: generating HIGH-risk document (required_approver_count=2)...")
    high_doc = client.generate_document(
        template_name="Tegata Warrant (verification)",
        template_urn=template_urn,
        document_name=f"verify-high-{uuid.uuid4().hex[:8]}",
        variables=[
            TemplateVariable(name="resource", value="db_payment_prod"),
            TemplateVariable(name="requested_by", value="verify-script"),
            TemplateVariable(name="reason", value="verification run"),
            TemplateVariable(name="requested_duration_minutes", value="1440"),
            TemplateVariable(name="max_duration_minutes", value="60"),
            TemplateVariable(name="risk_score", value="92"),
            TemplateVariable(name="risk_tier", value="high"),
            TemplateVariable(name="required_approver_count", value="2"),
        ],
        external_request_id=f"verify-high-{uuid.uuid4().hex[:8]}",
    )
    print(f"  Generated: {high_doc}")

    print("\nStep 2: re-uploading template (single-use — auto-deleted after Step 1's generate)...")
    uploaded_2 = client.upload_template(docx_path)
    template_urn_2 = uploaded_2["id"]
    print(f"  Uploaded: {uploaded_2}")

    print("\nStep 3: generating LOW-risk document (required_approver_count=1)...")
    low_doc = client.generate_document(
        template_name="Tegata Warrant (verification)",
        template_urn=template_urn_2,
        document_name=f"verify-low-{uuid.uuid4().hex[:8]}",
        variables=[
            TemplateVariable(name="resource", value="internal_wiki"),
            TemplateVariable(name="requested_by", value="verify-script"),
            TemplateVariable(name="reason", value="verification run"),
            TemplateVariable(name="requested_duration_minutes", value="15"),
            TemplateVariable(name="max_duration_minutes", value="15"),
            TemplateVariable(name="risk_score", value="10"),
            TemplateVariable(name="risk_tier", value="low"),
            TemplateVariable(name="required_approver_count", value="1"),
        ],
        external_request_id=f"verify-low-{uuid.uuid4().hex[:8]}",
    )
    print(f"  Generated: {low_doc}")

    print("\n" + "=" * 70)
    print("MANUAL STEP REQUIRED:")
    print("Open both generated documents (check the 'urn' in each result")
    print("above, or your Doctavian portal) and confirm:")
    print("  - The HIGH-risk doc says 'TWO approvers'")
    print("  - The LOW-risk doc says 'ONE approver'")
    print("If both say the same thing, reply to Kanwal's email thread and")
    print("ask what tag syntax to use for conditional content instead.")
    print("=" * 70)


if __name__ == "__main__":
    main()
