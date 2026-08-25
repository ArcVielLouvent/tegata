#!/usr/bin/env python3
"""
Real-time verification script for Phase 5 auto-expire.

Unlike the Doctavian/Foxit/NLU verify scripts, this one calls no external
API -- Phase 5's logic (ttl.py, audit_log.py, auto_expire.py) is pure
Python, so there's no third-party endpoint or auth flow to be "wrong"
about. What still needs proving for real, though, is that the
accelerated-TTL cycle actually elapses in genuine wall-clock time exactly
as the math says it will, driven by real time.sleep() polling -- NOT an
injected `now` timestamp like every case in test_auto_expire.py uses.

This is, deliberately, the literal script to run while screen-recording
for the demo video: ROADMAP.md's Phase 5 "done when" criteria and
docs/tegata-concept.md section 6, Wow Moment #3 ("Real-time auto-expire
— countdown, then status flips automatically with no click").

Usage:
    python scripts/verify_auto_expire_demo.py
    python scripts/verify_auto_expire_demo.py --minutes 20 --accel 1 --poll 2

What this does:
    1. Builds a warrant's audit trail up through "active" -- requested ->
       scored -> pending_approval -> signed -> active -- logging a real
       hash-chained AuditLogEntry at each step via audit_log.append_entry().
    2. Computes expires_at with ttl.compute_expires_at(), using the given
       acceleration (default: 1 real second standing in for 1 requested
       minute).
    3. Polls in a loop with real time.sleep(), calling
       auto_expire.check_and_expire() on each tick -- exactly what a Xano
       scheduled task's sweep does -- printing a live countdown.
    4. The instant it flips, prints the "auto_expired" audit entry
       (actor=None -- confirming zero human action took place) and runs
       audit_log.verify_chain() over the whole trail to confirm nothing
       in the recorded history is inconsistent.
"""
import argparse
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path

_AGENT_SRC = Path(__file__).resolve().parent.parent / "apps" / "agent" / "src"
_SCHEMA_SRC = Path(__file__).resolve().parent.parent / "packages" / "schema" / "python"
sys.path.insert(0, str(_AGENT_SRC))
sys.path.insert(0, str(_SCHEMA_SRC))

from tegata_agent.audit_log import append_entry, verify_chain  # noqa: E402
from tegata_agent.auto_expire import check_and_expire  # noqa: E402
from tegata_agent.ttl import compute_expires_at, seconds_until_expiry  # noqa: E402


def main():
    parser = argparse.ArgumentParser(
        description="Real-time demo of the Phase 5 active -> auto-expire cycle."
    )
    parser.add_argument(
        "--minutes", type=int, default=15,
        help="Requested/approved duration in minutes (default: 15)",
    )
    parser.add_argument(
        "--accel", type=float, default=1.0,
        help="Real seconds standing in for each requested minute (default: 1.0)",
    )
    parser.add_argument(
        "--poll", type=float, default=2.0,
        help="Seconds between sweep ticks, mirrors a Xano scheduled task interval (default: 2.0)",
    )
    args = parser.parse_args()

    warrant_id = f"demo-{uuid.uuid4().hex[:8]}"
    real_window = args.minutes * args.accel
    print(f"Warrant ID: {warrant_id}")
    print(
        f"Requested duration: {args.minutes} min, accelerated at {args.accel}s/min "
        f"-> real window: {real_window:.1f}s\n"
    )

    print("Building audit trail up to 'active'...")
    chain = []
    for event in ["requested", "scored", "pending_approval", "signed"]:
        entry = append_entry(
            warrant_id=warrant_id,
            event=event,
            entry_id=str(uuid.uuid4()),
            previous_entry=chain[-1] if chain else None,
        )
        chain.append(entry)
        print(f"  [{entry.timestamp.isoformat()}] {event:<17} hash={entry.hash[:12]}...")

    activated_at = datetime.now(UTC)
    activated_entry = append_entry(
        warrant_id=warrant_id,
        event="active",
        entry_id=str(uuid.uuid4()),
        previous_entry=chain[-1],
        timestamp=activated_at,
    )
    chain.append(activated_entry)
    print(f"  [{activated_entry.timestamp.isoformat()}] {'active':<17} hash={activated_entry.hash[:12]}...\n")

    expires_at = compute_expires_at(
        activated_at,
        max_duration_minutes=args.minutes,
        acceleration_seconds_per_minute=args.accel,
    )
    print(f"Computed expires_at: {expires_at.isoformat()}")
    print("Polling in real time (Ctrl+C to abort) -- this is the exact loop a")
    print("Xano scheduled task runs against every 'active' warrant:\n")

    status = "active"
    previous_entry = chain[-1]
    try:
        while status == "active":
            now = datetime.now(UTC)
            remaining = seconds_until_expiry(expires_at, now=now)
            print(f"  tick {now.isoformat()}  status=active  remaining={remaining:6.1f}s")

            result = check_and_expire(
                warrant_id=warrant_id,
                current_status=status,
                expires_at=expires_at,
                previous_audit_entry=previous_entry,
                now=now,
            )
            if result.should_expire:
                status = result.new_status
                chain.append(result.audit_entry)
                previous_entry = result.audit_entry
                print(
                    f"\n  >>> AUTO-EXPIRED at {result.audit_entry.timestamp.isoformat()} "
                    f"(event={result.audit_entry.event}, actor={result.audit_entry.actor}) <<<\n"
                )
                break

            time.sleep(args.poll)
    except KeyboardInterrupt:
        print("\nAborted by user before expiry -- nothing to verify, exiting.")
        sys.exit(1)

    print("Verifying the full recorded audit chain is intact (hash-chain check)...")
    verify_chain(chain)
    print(
        f"OK: {len(chain)} entries, chain verified end-to-end, "
        "zero human action taken to trigger the expiry."
    )


if __name__ == "__main__":
    main()
