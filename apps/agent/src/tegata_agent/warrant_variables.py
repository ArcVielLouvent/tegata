"""
Maps AccessRequest + RiskScore + ApprovalRequirement (Phase 1 output) into
the TemplateVariable list Doctavian's generate_document expects.

This is the glue that makes the "document structure changes with risk"
story real: the values here (especially required_approver_count) are what
the template's native Word IF field (see template_builder.py) branches on.
"""
from __future__ import annotations

from tegata_agent.approval_rules import ApprovalRequirement
from tegata_agent.doctavian_client import TemplateVariable
from tegata_agent.risk_engine import ScoreBreakdown


def build_warrant_variables(
    resource: str,
    requested_by: str,
    reason: str,
    requested_duration_minutes: int,
    risk_score: int,
    risk_tier: str,
    breakdown: ScoreBreakdown,
    approval: ApprovalRequirement,
) -> list[TemplateVariable]:
    return [
        TemplateVariable(name="resource", value=resource),
        TemplateVariable(name="requested_by", value=requested_by),
        TemplateVariable(name="reason", value=reason),
        TemplateVariable(
            name="requested_duration_minutes", value=str(requested_duration_minutes)
        ),
        TemplateVariable(
            name="max_duration_minutes", value=str(approval.max_duration_minutes)
        ),
        TemplateVariable(name="risk_score", value=str(risk_score)),
        TemplateVariable(name="risk_tier", value=risk_tier),
        TemplateVariable(
            name="required_approver_count", value=str(approval.required_approver_count)
        ),
        # Individual factor breakdown, useful for the audit trail / demo
        # narrative even if not shown directly in the rendered document.
        TemplateVariable(
            name="factor_resource_sensitivity", value=str(breakdown.resource_sensitivity)
        ),
        TemplateVariable(name="factor_duration", value=str(breakdown.duration_factor)),
        TemplateVariable(
            name="factor_time_of_day", value=str(breakdown.time_of_day_factor)
        ),
        TemplateVariable(
            name="factor_requester_history", value=str(breakdown.requester_history_factor)
        ),
    ]
