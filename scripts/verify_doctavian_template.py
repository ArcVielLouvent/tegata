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
    python scripts/verify_doctavian_template.py <template-url> <urn>
"""
import os
import sys
import uuid
from pathlib import Path

_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
sys.path.insert(0, str(_AGENT_SRC))

from tegata_agent.doctavian_client import DoctavianClient, DoctavianConfig, TemplateVariable  # noqa: E402


def main():
    if len(sys.argv) != 3:
        print("Usage: python scripts/verify_doctavian_template.py <template-url> <urn>")
        sys.exit(1)

    template_url = sys.argv[1]
    template_urn = sys.argv[2]

    api_key = os.environ.get("DOCTAVIAN_API_KEY")
    base_url = os.environ.get("DOCTAVIAN_API_BASE_URL", "https://demo.api.doctavian.com")
    if not api_key:
        print("Error: set DOCTAVIAN_API_KEY first.")
        sys.exit(1)

    client = DoctavianClient(DoctavianConfig(api_key=api_key, base_url=base_url))

    print("Step 1: registering template...")
    template = client.create_template(
        name="Tegata Warrant (verification)",
        description="Verification run — safe to delete after.",
        title="Warrant",
        urn=template_urn,
        url=template_url,
        path="templates/tegata-warrant-verify.docx",
    )
    print(f"  Registered: {template['documentTemplateGuid']}")

    print("\nStep 2: generating HIGH-risk document (required_approver_count=2)...")
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

    print("\nStep 3: generating LOW-risk document (required_approver_count=1)...")
    low_doc = client.generate_document(
        template_name="Tegata Warrant (verification)",
        template_urn=template_urn,
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
    print("Open both generated documents and confirm:")
    print("  - The HIGH-risk doc says 'TWO approvers'")
    print("  - The LOW-risk doc says 'ONE approver'")
    print("If both say the same thing, reply to Kanwal's email thread and")
    print("ask what tag syntax to use for conditional content instead.")
    print("=" * 70)


if __name__ == "__main__":
    main()
