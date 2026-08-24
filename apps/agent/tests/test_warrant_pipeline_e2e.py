from datetime import UTC, datetime

from tegata_agent.approval_rules import derive_approval_requirement
from tegata_agent.risk_engine import RequesterContext, compute_risk_score
from tegata_agent.warrant_variables import build_warrant_variables


def _variables_to_dict(variables):
    return {v.name: v.value for v in variables}


def test_high_risk_and_low_risk_produce_different_approval_structure():
    """This is the core demo moment (see docs/tegata-concept.md section 6,
    moment #1): two requests with different risk profiles must result in
    a genuinely different approval structure, not just different text."""

    weekend_night = datetime(2026, 8, 29, 23, 0, tzinfo=UTC)
    business_hours = datetime(2026, 8, 24, 10, 0, tzinfo=UTC)

    # High-risk scenario
    high_score, high_tier, high_breakdown = compute_risk_score(
        resource="db_payment_prod",
        requested_duration_minutes=1440,
        request_time=weekend_night,
        context=RequesterContext(prior_high_risk_requests_in_window=2),
    )
    high_approval = derive_approval_requirement(high_tier, 1440)
    high_vars = _variables_to_dict(
        build_warrant_variables(
            resource="db_payment_prod",
            requested_by="alice",
            reason="incident investigation",
            requested_duration_minutes=1440,
            risk_score=high_score,
            risk_tier=high_tier,
            breakdown=high_breakdown,
            approval=high_approval,
        )
    )

    # Low-risk scenario
    low_score, low_tier, low_breakdown = compute_risk_score(
        resource="internal_wiki",
        requested_duration_minutes=15,
        request_time=business_hours,
        context=RequesterContext(prior_high_risk_requests_in_window=0),
    )
    low_approval = derive_approval_requirement(low_tier, 15)
    low_vars = _variables_to_dict(
        build_warrant_variables(
            resource="internal_wiki",
            requested_by="bob",
            reason="check onboarding doc",
            requested_duration_minutes=15,
            risk_score=low_score,
            risk_tier=low_tier,
            breakdown=low_breakdown,
            approval=low_approval,
        )
    )

    # The assertion that matters most: approver count genuinely differs
    assert high_vars["required_approver_count"] == "2"
    assert low_vars["required_approver_count"] == "1"

    # And the tiers/scores are meaningfully different, not coincidentally equal
    assert high_vars["risk_tier"] == "high"
    assert low_vars["risk_tier"] == "low"
    assert int(high_vars["risk_score"]) > int(low_vars["risk_score"])

    # Duration cap actually enforced (high risk requester asked for 1440,
    # capped down to 60 by policy — see approval_rules.py)
    assert high_vars["max_duration_minutes"] == "60"
    assert high_vars["requested_duration_minutes"] == "1440"


def test_all_expected_variable_names_present():
    score, tier, breakdown = compute_risk_score(
        resource="server_web_prod",
        requested_duration_minutes=100,
    )
    approval = derive_approval_requirement(tier, 100)
    variables = build_warrant_variables(
        resource="server_web_prod",
        requested_by="carol",
        reason="deploy hotfix",
        requested_duration_minutes=100,
        risk_score=score,
        risk_tier=tier,
        breakdown=breakdown,
        approval=approval,
    )
    names = {v.name for v in variables}
    expected = {
        "resource",
        "requested_by",
        "reason",
        "requested_duration_minutes",
        "max_duration_minutes",
        "risk_score",
        "risk_tier",
        "required_approver_count",
        "factor_resource_sensitivity",
        "factor_duration",
        "factor_time_of_day",
        "factor_requester_history",
    }
    assert names == expected
