"""
Warrant state machine.

Enforces which status transitions are legal. Reference implementation to
mirror inside Xano's Function Stack (see docs/xano-setup.md) — Xano is the
actual source of truth for a warrant's status in production; this module
exists so the transition rules can be unit-tested precisely before being
recreated there, and so tests elsewhere in this repo can exercise the
same rules locally.
"""
from __future__ import annotations


class InvalidTransitionError(Exception):
    def __init__(self, current: str, target: str):
        super().__init__(f"Cannot transition from '{current}' to '{target}'")
        self.current = current
        self.target = target


# Maps each status to the set of statuses it is allowed to move to.
VALID_TRANSITIONS: dict[str, set[str]] = {
    "requested": {"scored"},
    "scored": {"pending_approval"},
    "pending_approval": {"signed", "expired_unapproved"},
    "signed": {"active"},
    "active": {"expired", "revoked"},
    "expired": set(),
    "revoked": set(),
    "expired_unapproved": set(),
}

ALL_STATUSES = set(VALID_TRANSITIONS.keys())


def validate_transition(current: str, target: str) -> None:
    """Raises InvalidTransitionError if the transition is not allowed.
    Returns None (silently) if it is allowed."""
    if current not in ALL_STATUSES:
        raise ValueError(f"Unknown current status: {current!r}")
    if target not in ALL_STATUSES:
        raise ValueError(f"Unknown target status: {target!r}")
    if target not in VALID_TRANSITIONS[current]:
        raise InvalidTransitionError(current, target)


def is_terminal(status: str) -> bool:
    if status not in ALL_STATUSES:
        raise ValueError(f"Unknown status: {status!r}")
    return len(VALID_TRANSITIONS[status]) == 0
