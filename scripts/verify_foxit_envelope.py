#!/usr/bin/env python3
"""
Real-network verification script for the Foxit eSign integration.

Run this in your Codespace (NOT in Claude's sandbox — same network
restriction as Doctavian's script).

Usage:
    export FOXIT_ESIGN_API_KEY=foxit_s5Qpk4...vD4      # client_id
    export FOXIT_ESIGN_API_SECRET=<client_secret>
    export FOXIT_ESIGN_API_BASE_URL=https://na1.fusion.foxit.com/esign/api

    python scripts/verify_foxit_envelope.py your-real-email@example.com

Replace the email with one you actually control, so you can see the
real signature request land in your inbox and click through the
Foxit signing flow — that's the only way to confirm the whole
generate-then-verify loop actually works end to end.

What this does:
    1. Generates a minimal test PDF (no special tags needed for Foxit,
       unlike Doctavian's Word-field approach).
    2. Creates a signature envelope ("folder") with ONE party (you) and
       ONE signature field — createEmbeddedSigningSession is left False
       so this uses email-based signing (you'll get an email).
    3. Prints the folderId. Go check your email, sign the document.
    4. Prompts you to press Enter once you've signed, then polls
       get_envelope_details() to confirm folderStatus == "EXECUTED" and
       shows the "Folder History" audit trail.
    5. Downloads the signed file as a ZIP to confirm download works too.
"""
import os
import sys
import time
from pathlib import Path

_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
sys.path.insert(0, str(_AGENT_SRC))

from tegata_agent.foxit_client import FoxitClient, FoxitConfig, Party, SignatureField  # noqa: E402
from tegata_agent.foxit_test_pdf import build_test_warrant_pdf  # noqa: E402


def main():
    if len(sys.argv) != 2:
        print("Usage: python scripts/verify_foxit_envelope.py <your-real-email>")
        sys.exit(1)

    signer_email = sys.argv[1]

    client_id = os.environ.get("FOXIT_ESIGN_API_KEY")
    client_secret = os.environ.get("FOXIT_ESIGN_API_SECRET")
    base_url = os.environ.get("FOXIT_ESIGN_API_BASE_URL", "https://na1.fusion.foxit.com/esign/api")
    if not client_id or not client_secret:
        print("Error: set FOXIT_ESIGN_API_KEY and FOXIT_ESIGN_API_SECRET first.")
        sys.exit(1)

    client = FoxitClient(FoxitConfig(client_id=client_id, client_secret=client_secret, base_url=base_url))

    print("Step 1: generating test PDF...")
    pdf_path = build_test_warrant_pdf("/tmp/tegata-verify-warrant.pdf")
    print(f"  Built: {pdf_path}")

    print(f"\nStep 2: creating envelope, sending to {signer_email}...")
    result = client.create_envelope_from_binary(
        pdf_path=pdf_path,
        folder_name="Tegata Warrant (verification)",
        parties=[Party(first_name="Approver", last_name="Test", email=signer_email)],
        fields=[
            SignatureField(type="signature", x=100, y=250, width=150, height=40, party=1),
        ],
        send_now=True,
    )
    print(f"  Result: {result}")

    folder_id = result.get("folderId") or result.get("folder", {}).get("folderId")
    if not folder_id:
        print("Could not find folderId in response — check the raw result above manually.")
        sys.exit(1)

    print(f"\nfolderId = {folder_id}")
    print("=" * 70)
    print(f"Check {signer_email} for the signing invitation email, sign the")
    print("document, then come back here.")
    print("=" * 70)
    input("Press Enter once you've signed the document...")

    print("\nStep 3: polling envelope status...")
    for attempt in range(5):
        details = client.get_envelope_details(folder_id)
        status = details.get("folder", {}).get("folderStatus", "UNKNOWN")
        print(f"  Attempt {attempt + 1}: folderStatus = {status}")
        if status == "EXECUTED":
            break
        time.sleep(3)

    print("\nAudit trail (Folder History):")
    for entry in details.get("Folder History", []):
        print(f"  {entry}")

    if status == "EXECUTED":
        print("\nStep 4: downloading signed files...")
        zip_bytes = client.download_envelope_files(folder_id)
        out_path = Path("/tmp/tegata-verify-signed.zip")
        out_path.write_bytes(zip_bytes)
        print(f"  Downloaded {len(zip_bytes)} bytes to {out_path}")
        print("\nSUCCESS: full generate -> sign -> verify -> download loop confirmed.")
    else:
        print(f"\nStatus is still '{status}', not EXECUTED — did you actually sign it yet?")
        print("Re-run this script, or just call get_envelope_details() again later.")


if __name__ == "__main__":
    main()
