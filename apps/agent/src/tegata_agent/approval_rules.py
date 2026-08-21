"""
Approval requirement rules.

Given a risk tier, decide how many approvers are required and what the
maximum allowed access duration is — regardless of what the requester
asked for. This is the piece that turns "the system enforces policy" from
a claim into an actual, testable guarantee (see Warrant.approval_requirement
in packages/schema/tegata.schema.json).

Like risk_engine.py, this is a reference implementation to mirror inside
Xano's Function Stack (see docs/xano-setup.md) — Doctavian consumes this
output to decide the document's clause structure (Phase 2).
"""
from __future__ import annotations

from dataclasses import dataclass

APPROVAL_RULES: dict[str, dict[str, int]] = {
    "high": {"required_approver_count": 2, "max_duration_minutes": 60},
    "medium": {"required_approver_count": 1, "max_duration_minutes": 240},
    "low": {"required_approver_count": 1, "max_duration_minutes": 1440},
}


@dataclass
class ApprovalRequirement:
    required_approver_count: int
    max_duration_minutes: int
    duration_was_capped: bool


def derive_approval_requirement(
    tier: str, requested_duration_minutes: int
) -> ApprovalRequirement:
    if tier not in APPROVAL_RULES:
        raise ValueError(f"Unknown risk tier: {tier!r}")

    rule = APPROVAL_RULES[tier]
    tier_cap = rule["max_duration_minutes"]
    effective_max = min(requested_duration_minutes, tier_cap)

    return ApprovalRequirement(
        required_approver_count=rule["required_approver_count"],
        max_duration_minutes=effective_max,
        duration_was_capped=effective_max < requested_duration_minutes,
    )
