import pytest

from tegata_agent.approval_rules import derive_approval_requirement


def test_high_risk_requires_two_approvers_and_caps_duration():
    req = derive_approval_requirement("high", requested_duration_minutes=240)
    assert req.required_approver_count == 2
    assert req.max_duration_minutes == 60  # capped from 240 down to the high-risk limit
    assert req.duration_was_capped is True


def test_high_risk_does_not_extend_a_short_request():
    # requester only asked for 10 minutes — the cap should not grant them more
    req = derive_approval_requirement("high", requested_duration_minutes=10)
    assert req.max_duration_minutes == 10
    assert req.duration_was_capped is False


def test_medium_risk_requires_one_approver():
    req = derive_approval_requirement("medium", requested_duration_minutes=100)
    assert req.required_approver_count == 1
    assert req.max_duration_minutes == 100
    assert req.duration_was_capped is False


def test_medium_risk_caps_long_request():
    req = derive_approval_requirement("medium", requested_duration_minutes=1000)
    assert req.max_duration_minutes == 240
    assert req.duration_was_capped is True


def test_low_risk_allows_full_day():
    req = derive_approval_requirement("low", requested_duration_minutes=1440)
    assert req.required_approver_count == 1
    assert req.max_duration_minutes == 1440
    assert req.duration_was_capped is False


def test_unknown_tier_raises():
    with pytest.raises(ValueError):
        derive_approval_requirement("critical", requested_duration_minutes=60)
