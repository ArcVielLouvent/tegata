"""
Signature verification + anti-replay.

Reference implementation for the gap flagged in docs/xano-setup.md §9:
the Xano-side endpoint that receives a Foxit-signed document back must
(1) verify the warrant hasn't already been used (anti-replay), (2) verify
the envelope is genuinely fully executed, (3) verify the returned document
and signer match what was actually sent for signature (anti-tampering),
and only then flip `used = true` and transition `signed -> active`.

This was correctly NOT built directly in Xano before this module existed
(see PROJECT_STATUS.md, Xano first-pass section) — building it blind
risks silently reintroducing the exact replay bug this project's core
security claim depends on catching. This module is the reference to
mirror inside Xano's Function Stack; see docs/xano-setup.md §9a.

This module does not call Foxit directly (foxit_client.py already does
that, Phase 3) — it takes already-fetched envelope/document facts as
plain arguments so the decision logic can be unit-tested deterministically
without a live envelope.
"""
from __future__ import annotations

from dataclasses import dataclass

from tegata_agent.state_machine import validate_transition


class ReplayRejectedError(Exception):
    """Raised when a warrant_id has already been used to activate access.

    This check MUST run before anything about the incoming envelope is
    even inspected — a replay attempt should be rejected based on the
    warrant's own persisted state, not on whatever envelope happens to
    be attached to the request. See ROADMAP.md Phase 3 "done when":
    this is the wow-moment the demo depends on being genuinely
    reproducible, not just claimed.
    """

    def __init__(self, warrant_id: str):
        super().__init__(f"Warrant '{warrant_id}' has already been used — replay rejected.")
        self.warrant_id = warrant_id


class EnvelopeNotExecutedError(Exception):
    def __init__(self, envelope_status: str):
        super().__init__(f"Envelope is not yet fully executed (status={envelope_status!r}).")
        self.envelope_status = envelope_status


class SignatureMismatchError(Exception):
    """Anti-tampering: the document/signer that came back doesn't match
    what was originally sent for signature."""

    def __init__(self, reason: str):
        super().__init__(f"Signature verification failed: {reason}")
        self.reason = reason


@dataclass
class VerificationResult:
    warrant_id: str
    new_status: str  # always "active" if this function returns at all
    signer_email: str


def verify_and_activate(
    *,
    warrant_id: str,
    current_status: str,
    used: bool,
    envelope_status: str,
    expected_document_hash: str,
    returned_document_hash: str,
    expected_signer_email: str,
    signer_email: str,
) -> VerificationResult:
    """Runs all checks in order, cheapest/most security-critical first:

    1. Anti-replay — `used` must be False.
    2. Envelope must be fully executed (all parties signed), not just
       sent/viewed/partially signed.
    3. Anti-tampering — returned document hash and signer identity must
       match what was sent for signature.
    4. Only if 1-3 pass: run the transition through state_machine's
       single source of truth (signed -> active). An unexpected
       `current_status` (e.g. already active, or never signed) raises
       state_machine.InvalidTransitionError, same as everywhere else in
       this project — this function does not duplicate that rule.

    Raises the first applicable error above; returns VerificationResult
    (used=True, status="active" — caller persists both) only if every
    check passes.
    """
    if used:
        raise ReplayRejectedError(warrant_id)

    if envelope_status != "EXECUTED":
        raise EnvelopeNotExecutedError(envelope_status)

    if returned_document_hash != expected_document_hash:
        raise SignatureMismatchError(
            "returned document hash does not match the version sent for signing"
        )

    if signer_email.strip().lower() != expected_signer_email.strip().lower():
        raise SignatureMismatchError(
            f"signer {signer_email!r} does not match expected approver {expected_signer_email!r}"
        )

    validate_transition(current_status, "active")

    return VerificationResult(warrant_id=warrant_id, new_status="active", signer_email=signer_email)
