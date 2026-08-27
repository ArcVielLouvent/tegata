"""
Auto-expire orchestration.

Ties together state_machine.py (Phase 1), ttl.py, and audit_log.py
(both Phase 5): given a warrant currently in "active" status plus its
expires_at timestamp, decides whether it should transition to "expired"
right now, and if so, returns both the new status and the audit log
entry recording it.

This is a PURE function — no database/Xano call happens here. The real
production trigger is a Xano scheduled task (see docs/xano-setup.md,
Phase 5 section) that runs this same logic against every row currently
in "active" status, on a short interval (e.g. every 10-15 seconds for
the accelerated demo TTL, every few minutes in a real deployment).

Calling this repeatedly on the same warrant is always safe: once a
warrant is no longer "active" (already expired, revoked, or never
reached active), the result is a no-op every time, regardless of how
much time has passed. This is what lets a scheduled task simply sweep
every row on a fixed interval without needing to track which ones it
already handled.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from models import AuditLogEntry

from tegata_agent import state_machine
from tegata_agent.audit_log import append_entry
from tegata_agent.ttl import is_expired


@dataclass
class ExpiryCheckResult:
    should_expire: bool
    new_status: str | None
    audit_entry: AuditLogEntry | None


def check_and_expire(
    warrant_id: str,
    current_status: str,
    expires_at: datetime,
    previous_audit_entry: AuditLogEntry | None,
    now: datetime | None = None,
    entry_id_factory=lambda: str(uuid.uuid4()),
) -> ExpiryCheckResult:
    """If current_status is "active" and now >= expires_at: validates the
    active -> expired transition through state_machine (so this can never
    silently perform a transition state_machine.py wouldn't otherwise
    allow — one source of truth, not two copies of the same rule) and
    builds the audit entry recording the auto-expiry.

    Returns should_expire=False (a no-op) in every other case: not yet
    expired, or current_status isn't "active" at all (already terminal,
    or hasn't reached active yet)."""
    now = now or datetime.now(UTC)

    if current_status != "active" or not is_expired(expires_at, now=now):
        return ExpiryCheckResult(should_expire=False, new_status=None, audit_entry=None)

    # Raises InvalidTransitionError if this is somehow not a legal move --
    # should never actually trigger given the current_status check above,
    # but routing through state_machine here keeps it as the single
    # source of truth instead of duplicating "active -> expired is legal"
    # as a second, driftable assumption in this module.
    state_machine.validate_transition(current_status, "expired")

    entry = append_entry(
        warrant_id=warrant_id,
        event="auto_expired",
        entry_id=entry_id_factory(),
        previous_entry=previous_audit_entry,
        actor=None,  # no human actor — the system acted on its own
        timestamp=now,
    )

    return ExpiryCheckResult(should_expire=True, new_status="expired", audit_entry=entry)
