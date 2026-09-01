#!/usr/bin/env python3
"""
Real-network smoke test for the 3 Phase 7 document routes that have
never been run against real Doctavian / Foxit PDF Services:

    - POST /api/documents/generate-progressive  (item 4, progressive
      disclosure, pivoted from Foxit Smart Redact)
    - POST /api/documents/generate-dual         (Stretch E, dual-audience)
    - POST /api/documents/verify-consistency    (Stretch B, OCR check)

Run this against your OWN machine (this sandbox can't reach Doctavian
or na1.fusion.foxit.com), with the app already running:

    npm run build && npm run start   # in apps/web, separate terminal

    export DOCTAVIAN_ACCESS_TOKEN=...          # or however your .env.local names it
    export FOXIT_PDF_SERVICES_API_KEY=...
    export FOXIT_PDF_SERVICES_API_SECRET=...

    python scripts/verify_stretch_document_routes.py --base-url http://localhost:3000

None of these three routes look anything up in Xano -- they take
warrant fields directly as JSON input (see each route.ts's own
docstring) -- so this script fabricates a plausible warrant payload
rather than needing a real one to already exist. That's a real
difference from every other verify_*.py script in this repo: this
tests "does the route + Doctavian/Foxit call work at all," not "does
it work for a warrant a real user actually created."

What "pass" looks like for each, since none of this can be asserted
automatically without a human looking at a PDF:
  - generate-progressive: two PDFs get saved to disk
    (progressive_redacted.pdf, progressive_full.pdf) — open both and
    confirm the "redacted" one visibly hides the section the "full"
    one shows (the specific conditional paragraph, per
    docs/templates/tegata-warrant-progressive.docx).
  - generate-dual: two PDFs get saved (dual_warrant.pdf,
    dual_runbook.pdf) — open both, confirm the runbook reads like an
    operator runbook (imperative steps) and the warrant doc reads like
    the usual formal grant document, not the same content twice.
  - verify-consistency: run TWICE, once against a PDF whose text
    actually contains the facts you pass in --expected-facts (should
    print consistent=True), and once against a PDF that DOESN'T
    (should print consistent=False with the missing facts named) — the
    script does the first for you automatically using generate-dual's
    own output as the "known good" PDF; do the second manually with any
    unrelated PDF you have lying around, that's the tamper-detection
    case this is actually meant to catch.
"""
import argparse
import base64
import json
import sys
from pathlib import Path

import requests

SAMPLE_WARRANT = {
    "warrant_id": "smoke-test-warrant-0001",
    "resource": "internal_wiki",
    "requested_by": "smoke-test@tegata.local",
    "reason": "Verifying Phase 7 document generation routes end-to-end.",
    "requested_duration_minutes": 30,
    "risk_score": 42,
    "risk_tier": "medium",
    "factors": {
        "resource_sensitivity": 0.4,
        "duration_factor": 0.2,
        "time_of_day_factor": 0.1,
        "requester_history_factor": 0.0,
    },
    "approval_requirement": {"required_approver_count": 1, "max_duration_minutes": 60},
}


def save_pdf(b64: str, path: Path):
    path.write_bytes(base64.b64decode(b64))
    print(f"   -> saved {path} ({path.stat().st_size} bytes)")


def test_generate_progressive(base_url: str, out_dir: Path) -> bool:
    print("\n=== generate-progressive (item 4) ===")
    ok = True
    for level in ("redacted", "full"):
        body = {**SAMPLE_WARRANT, "reveal_level": level}
        resp = requests.post(f"{base_url}/api/documents/generate-progressive", json=body)
        print(f"  reveal_level={level}: HTTP {resp.status_code}")
        if resp.status_code != 200:
            print(f"  FAIL: {resp.text[:500]}")
            ok = False
            continue
        result = resp.json()
        save_pdf(result["pdf_base64"], out_dir / f"progressive_{level}.pdf")
    print("  -> Open both PDFs. The 'redacted' one must visibly hide the")
    print("     technical-execution-details section the 'full' one shows.")
    return ok


def test_generate_dual(base_url: str, out_dir: Path) -> dict | None:
    print("\n=== generate-dual (Stretch E) ===")
    resp = requests.post(f"{base_url}/api/documents/generate-dual", json=SAMPLE_WARRANT)
    print(f"  HTTP {resp.status_code}")
    if resp.status_code != 200:
        print(f"  FAIL: {resp.text[:500]}")
        return None
    result = resp.json()
    save_pdf(result["warrant_pdf_base64"], out_dir / "dual_warrant.pdf")
    save_pdf(result["runbook_pdf_base64"], out_dir / "dual_runbook.pdf")
    print("  -> Open both. The runbook should read like operator steps,")
    print("     the warrant doc like the usual formal grant document.")
    return result


def test_verify_consistency(base_url: str, dual_result: dict | None) -> bool:
    print("\n=== verify-consistency (Stretch B) ===")
    if dual_result is None:
        print("  SKIPPED — generate-dual didn't succeed, nothing to check against.")
        return False

    expected_facts = {
        "resource": SAMPLE_WARRANT["resource"],
        "requested_by": SAMPLE_WARRANT["requested_by"],
    }
    body = {
        "pdf_base64": dual_result["warrant_pdf_base64"],
        "file_name": "dual_warrant.pdf",
        "expected_facts": expected_facts,
    }
    print(f"  Checking dual_warrant.pdf against facts it SHOULD contain: {expected_facts}")
    resp = requests.post(f"{base_url}/api/documents/verify-consistency", json=body)
    print(f"  HTTP {resp.status_code}")
    if resp.status_code != 200:
        print(f"  FAIL (route-level): {resp.text[:500]}")
        return False
    result = resp.json()
    print(f"  consistent={result.get('consistent')}, missingFacts={result.get('missingFacts')}")
    if result.get("consistent") is not True:
        print("  UNEXPECTED: this should have been consistent (the PDF was generated from these")
        print("  exact facts) — either OCR extraction or the fact-matching logic has a real bug.")
        print(f"  extractedTextPreview: {result.get('extractedTextPreview', '')[:300]!r}")
        return False
    print("  PASS on the positive case. Now do the negative case yourself: run this route")
    print("  again with a PDF that does NOT contain these facts and confirm consistent=False.")
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", default="http://localhost:3000")
    parser.add_argument("--out-dir", default="/tmp/tegata-phase7-smoke")
    args = parser.parse_args()

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"Output PDFs will be saved to: {out_dir}")

    results = {}
    results["progressive"] = test_generate_progressive(args.base_url, out_dir)
    dual_result = test_generate_dual(args.base_url, out_dir)
    results["dual"] = dual_result is not None
    results["consistency"] = test_verify_consistency(args.base_url, dual_result)

    print("\n=== Summary ===")
    for name, ok in results.items():
        print(f"  {name}: {'route responded 200' if ok else 'FAILED — see output above'}")
    print("\nNone of these are actually PASS/FAIL until a human opens the saved PDFs —")
    print("this script only confirms the routes ran without erroring.")

    sys.exit(0 if all(results.values()) else 1)


if __name__ == "__main__":
    main()
