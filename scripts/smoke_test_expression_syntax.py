#!/usr/bin/env python3
"""
SMOKE TEST — historical, hypothesis now SUPERSEDED. Kept for reference
only, not part of the production pipeline.

We've hit TEMPLATE_READ_FAILED repeatedly even after fixing the OOXML
field structure (verified 8/8/8 begin/separate/end — structurally valid).

Original hypothesis (as of 2026-08-24): Doctavian's template engine reads
PLAIN TEXT placeholders in its own expression syntax (e.g. "{!resource}"),
not native Word MERGEFIELD/IF field codes at all.

RESOLVED 2026-08-25 — hypothesis was WRONG, root cause was elsewhere:
Kanwal (Doctavian) reproduced our exact failure using our REAL template
(the native Word IF field version from template_builder.py, unchanged)
and our real generate-document request, then fixed it by ONLY swapping
the uploaded data file for one with a minimal-but-present top-level
"data" wrapper key (i.e. {"data": {}}, not a bare {}). The document then
generated and downloaded successfully — with the native Word IF field
template completely untouched. This confirms: (a) native Word
MERGEFIELD/IF fields DO work as originally designed in template_builder.py,
no rewrite needed, and (b) TEMPLATE_READ_FAILED was a misleading error
for what was actually a malformed data payload the whole time (Doctavian
has acknowledged the message is misleading and plans to improve it). See
scripts/verify_doctavian_template.py for the corrected data payload and
PROJECT_STATUS.md for the full timeline. This script is left as-is
(still uploads a bare {}) purely as a historical record of the
now-abandoned plain-text-placeholder hypothesis — do not use it as a
template for new work.

Usage:
    export DOCTAVIAN_API_KEY=...
    export DOCTAVIAN_ACCESS_TOKEN=...
    python scripts/smoke_test_expression_syntax.py
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

    # --- Build the simplest possible template: plain text, no Word fields ---
    doc = Document()
    doc.add_paragraph("Resource: {!resource}")
    with tempfile.NamedTemporaryFile(suffix=".docx", delete=False) as tmp:
        tmp_docx_path = Path(tmp.name)
    doc.save(tmp_docx_path)
    print(f"Built minimal plain-text template at {tmp_docx_path}")

    print("\nUploading template...")
    uploaded_template = client.upload_template(tmp_docx_path)
    print(f"  {uploaded_template}")

    print("\nUploading minimal data blob...")
    with tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False) as tmp:
        json.dump({}, tmp)
        tmp_data_path = Path(tmp.name)
    uploaded_data = client.upload_data(tmp_data_path)
    print(f"  {uploaded_data}")

    print("\nGenerating (plain-text placeholder, no Word fields)...")
    try:
        result = client.generate_document(
            template_name="smoke-test-plain-text",
            template_urn=uploaded_template["id"],
            document_name=f"smoke-test-{uuid.uuid4().hex[:8]}",
            variables=[],
            external_request_id=f"smoke-test-{uuid.uuid4().hex[:8]}",
            data_urn=uploaded_data["id"],
        )
        print(f"\nSUCCESS: {result}")
        print("\n=> Hypothesis CONFIRMED: plain-text {!...} placeholders work.")
        print("=> Native Word MERGEFIELD/IF fields are the wrong approach entirely.")
        print("=> template_builder.py needs a full rewrite using plain text placeholders.")
    except Exception as e:
        print(f"\nFAILED: {e}")
        print("\n=> Hypothesis NOT confirmed by this alone — TEMPLATE_READ_FAILED")
        print("   persists even with zero Word fields, so the problem is elsewhere")
        print("   (not field structure, not expression syntax). Time to email Kanwal")
        print("   with a minimal, fully reproducible failing case attached.")

    os.unlink(tmp_docx_path)
    os.unlink(tmp_data_path)


if __name__ == "__main__":
    main()
