#!/usr/bin/env python3
"""
Real-network verification script for Phase 7 item 1 — the
`GET /warrants/{warrant_id}/audit/verify` endpoint (Prompt A in
PROJECT_STATUS.md's "Explicit Xano AI build prompts" section).

Run this in your Codespace (NOT in Claude's sandbox — same network
restriction as the Doctavian/Foxit verify scripts).

Why this script exists, specifically: Xano's own agent wrote this
endpoint's Function Stack from a prompt describing our algorithm — it
was NOT generated from our tested audit_log.py code directly, so
there's real room for it to have recomputed the hash subtly
differently (wrong key order, wrong timestamp format, off-by-one on
which row starts the chain) and still "look" like it works for the
happy path. This script doesn't just call the endpoint and print
whatever it says — it also independently recomputes the same chain
locally with our own tested verify_chain() (9 passing unit tests,
including deliberate-tampering and broken-link cases) and confirms
the two answers agree. If Xano says "intact" but our own recompute
disagrees, that's Xano's implementation being wrong, not a false
alarm — the whole point of this script is to catch exactly that
before it's trusted on stage during the demo.

Usage:
    export XANO_API_BASE_URL=https://xalp-fftx-guat.n7e.xano.io/api:Ud1c3S7j
    export XANO_AUTH_TOKEN=<a real bearer token for an approver or security_admin account>

    python scripts/verify_audit_chain_endpoint.py <warrant_id>

    # To rehearse the actual demo moment (corrupt a row, confirm both
    # Xano's endpoint AND our own local recompute catch it), first hand-edit
    # one row's `reason` or `actor` field in Xano's Database tab, THEN run
    # this script against that same warrant_id.

What this does:
    1. GET /warrants/{warrant_id}/audit/verify — the real Xano endpoint.
    2. GET /audit-log?warrant_id=... — the raw rows, to recompute locally.
    3. Feeds those raw rows into our own tested verify_chain() and
       compares its verdict against what step 1 returned.
    4. Prints a clear PASS/DISAGREEMENT verdict — the second one means
       stop and go look at the Xano Function Stack, don't trust the
       endpoint yet.
"""
import argparse
import os
import sys
from datetime import datetime
from pathlib import Path

import requests

_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
_SCHEMA_SRC = Path(__file__).resolve().parent.parent / "packages" / "schema" / "python"
sys.path.insert(0, str(_AGENT_SRC))
sys.path.insert(0, str(_SCHEMA_SRC))

from tegata_agent.audit_log import ChainIntegrityError, verify_chain  # noqa: E402
from models import AuditLogEntry  # noqa: E402


def _parse_xano_timestamp(raw) -> datetime:
    """Xano's GET responses have historically NOT matched our first
    guess at their shape (see normalizeWarrant()'s own commit history) —
    handle both an epoch-millisecond int and an ISO string rather than
    assuming one, and fail loudly with the raw value if neither parses."""
    if isinstance(raw, (int, float)):
        return datetime.utcfromtimestamp(raw / 1000)
    if isinstance(raw, str):
        return datetime.fromisoformat(raw.replace("Z", "+00:00"))
    raise ValueError(f"Unrecognized timestamp shape from Xano: {raw!r} ({type(raw)})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("warrant_id")
    args = parser.parse_args()

    base_url = os.environ.get("XANO_API_BASE_URL")
    token = os.environ.get("XANO_AUTH_TOKEN")
    if not base_url or not token:
        print("Set XANO_API_BASE_URL and XANO_AUTH_TOKEN first — see this script's docstring.")
        sys.exit(1)

    headers = {"Authorization": f"Bearer {token}"}

    print(f"1. Calling GET /warrants/{args.warrant_id}/audit/verify ...")
    resp = requests.get(f"{base_url}/warrants/{args.warrant_id}/audit/verify", headers=headers)
    print(f"   HTTP {resp.status_code}")
    try:
        xano_result = resp.json()
    except ValueError:
        print(f"   FAIL: response wasn't JSON at all: {resp.text[:500]!r}")
        sys.exit(1)
    print(f"   Xano says: {xano_result}")
    if not isinstance(xano_result, dict):
        print(f"\n   FINDING: HTTP {resp.status_code} but the body is {xano_result!r}, not the")
        print("   {intact, checked_count, ...} object the endpoint is supposed to return.")
        print("   A 200 with a null/empty body for a warrant you don't own is a real gap, not")
        print("   a script bug: GET /audit-log correctly 403s for a non-owner in the same test,")
        print("   so this endpoint's ownership check either isn't wired the same way, or the")
        print("   underlying query/response step never actually ran. This needs to go back to")
        print("   Xano AI with this exact reproduction (see the reply below).")
        sys.exit(2)

    print(f"\n2. Calling GET /audit-log?warrant_id={args.warrant_id} for the raw rows ...")
    resp2 = requests.get(f"{base_url}/audit-log", params={"warrant_id": args.warrant_id}, headers=headers)
    print(f"   HTTP {resp2.status_code}")
    if resp2.status_code >= 400:
        print(f"   FINDING: {resp2.status_code} — you don't have access to this warrant's audit")
        print(f"   log (body: {resp2.text[:300]!r}). That's a DIFFERENT, more basic problem than")
        print("   'chain intact or not' — can't cross-check the hash chain at all without the raw")
        print("   rows. If you expected to own this warrant, that's the actual bug to chase; if")
        print("   you don't own it, this 403 is doing exactly what item 5's RBAC is supposed to do.")
        sys.exit(2)
    raw_rows = resp2.json()
    if isinstance(raw_rows, dict):
        # Unconfirmed which wrapper shape this endpoint actually uses --
        # print it so you can see for yourself and adjust below if this
        # guess (a top-level "items"/"result" list) is wrong.
        print(f"   NOTE: response is an object, not a bare list: keys={list(raw_rows.keys())}")
        raw_rows = raw_rows.get("items") or raw_rows.get("result") or raw_rows.get("audit_log") or []
    print(f"   Got {len(raw_rows)} rows.")

    print("\n3. Recomputing the chain locally with our own tested verify_chain() ...")
    entries = [
        AuditLogEntry(
            entry_id=row.get("entry_id") or row.get("id"),
            warrant_id=args.warrant_id,
            event=row["event"],
            timestamp=_parse_xano_timestamp(row["timestamp"]),
            actor=row.get("actor"),
            prev_hash=row.get("prev_hash"),
            hash=row["hash"],
        )
        for row in sorted(raw_rows, key=lambda r: r["timestamp"])
    ]

    local_intact = True
    local_broken_index = None
    local_broken_entry_id = None
    try:
        verify_chain(entries)
    except ChainIntegrityError as e:
        local_intact = False
        local_broken_index = e.index
        local_broken_entry_id = e.entry_id

    print(f"   Our own recompute says: intact={local_intact}"
          + (f", broken_at_index={local_broken_index}, broken_entry_id={local_broken_entry_id}" if not local_intact else ""))

    print("\n4. Verdict:")
    xano_intact = xano_result.get("intact")
    if xano_intact == local_intact and (
        local_intact or xano_result.get("broken_at_index") == local_broken_index
    ):
        print("   PASS — Xano's endpoint and our own tested logic agree.")
        sys.exit(0)
    else:
        print("   DISAGREEMENT — do not trust the Xano endpoint's answer yet.")
        print("   Go look at the actual Function Stack for GET /warrants/{warrant_id}/audit/verify")
        print("   and compare it line-by-line against audit_log.py's verify_chain()/_content_hash().")
        sys.exit(2)


if __name__ == "__main__":
    main()
