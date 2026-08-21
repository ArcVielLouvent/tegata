from datetime import UTC, datetime

import pytest

from tegata_agent.risk_engine import (
    RequesterContext,
    compute_risk_score,
    score_duration,
    score_requester_history,
    score_resource_sensitivity,
    score_time_of_day,
    tier_for_score,
)


def test_score_resource_sensitivity_known_resource():
    assert score_resource_sensitivity("db_payment_prod") == 50


def test_score_resource_sensitivity_unknown_resource_uses_default():
    assert score_resource_sensitivity("some_new_resource_nobody_registered") == 30


def test_score_duration_scales_with_length():
    short = score_duration(30)
    long = score_duration(720)  # half a day
    full_day = score_duration(1440)
    assert short < long < full_day
    assert full_day == 30  # capped at MAX_DURATION_FACTOR


def test_score_duration_is_capped_never_exceeds_max():
    # even at the schema's maximum (1440), the factor cannot exceed the cap
    assert score_duration(1440) <= 30


@pytest.mark.parametrize(
    "iso_datetime,expected_penalty",
    [
        ("2026-08-24T14:00:00+00:00", 0),  # Monday, 2pm — business hours, weekday
        ("2026-08-24T23:00:00+00:00", 15),  # Monday, 11pm — off hours only
        ("2026-08-29T14:00:00+00:00", 15),  # Saturday, 2pm — weekend only
        ("2026-08-29T23:00:00+00:00", 30),  # Saturday, 11pm — both penalties
    ],
)
def test_score_time_of_day(iso_datetime, expected_penalty):
    dt = datetime.fromisoformat(iso_datetime)
    assert score_time_of_day(dt) == expected_penalty


def test_score_requester_history_no_prior_requests():
    assert score_requester_history(RequesterContext(prior_high_risk_requests_in_window=0)) == 0


def test_score_requester_history_capped():
    # 10 prior requests * 5 points = 50, but capped at 15
    assert (
        score_requester_history(RequesterContext(prior_high_risk_requests_in_window=10)) == 15
    )


@pytest.mark.parametrize(
    "score,expected_tier",
    [
        (0, "low"),
        (39, "low"),
        (40, "medium"),
        (69, "medium"),
        (70, "high"),
        (100, "high"),
    ],
)
def test_tier_for_score_boundaries(score, expected_tier):
    assert tier_for_score(score) == expected_tier


def test_compute_risk_score_high_risk_scenario():
    # payment prod (50) + long duration (30, capped) + off-hours weekend (30)
    # + some history (10) = 120, capped at 100 -> high
    weekend_night = datetime(2026, 8, 29, 23, 0, tzinfo=UTC)
    score, tier, breakdown = compute_risk_score(
        resource="db_payment_prod",
        requested_duration_minutes=1440,
        request_time=weekend_night,
        context=RequesterContext(prior_high_risk_requests_in_window=2),
    )
    assert tier == "high"
    assert score == 100  # capped
    assert breakdown.resource_sensitivity == 50


def test_compute_risk_score_low_risk_scenario():
    business_hours = datetime(2026, 8, 24, 10, 0, tzinfo=UTC)  # Monday 10am
    score, tier, breakdown = compute_risk_score(
        resource="internal_wiki",
        requested_duration_minutes=15,
        request_time=business_hours,
        context=RequesterContext(prior_high_risk_requests_in_window=0),
    )
    assert tier == "low"
    assert score < 40
