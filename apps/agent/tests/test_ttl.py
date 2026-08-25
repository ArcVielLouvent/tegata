from datetime import UTC, datetime, timedelta

import pytest

from tegata_agent.ttl import compute_expires_at, is_expired, seconds_until_expiry


def test_compute_expires_at_real_minutes():
    start = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    expires = compute_expires_at(start, max_duration_minutes=60)
    assert expires == start + timedelta(minutes=60)


def test_compute_expires_at_accelerated_for_demo():
    start = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    # 60 requested minutes compressed to 1 real second per minute -> 60 real seconds
    expires = compute_expires_at(
        start, max_duration_minutes=60, acceleration_seconds_per_minute=1
    )
    assert expires == start + timedelta(seconds=60)


def test_compute_expires_at_rejects_non_positive_duration():
    start = datetime.now(UTC)
    with pytest.raises(ValueError):
        compute_expires_at(start, max_duration_minutes=0)


def test_compute_expires_at_rejects_non_positive_acceleration():
    start = datetime.now(UTC)
    with pytest.raises(ValueError):
        compute_expires_at(start, max_duration_minutes=10, acceleration_seconds_per_minute=0)


def test_is_expired_true_when_now_past_expiry():
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = datetime(2026, 8, 25, 10, 0, 1, tzinfo=UTC)
    assert is_expired(expires_at, now=now) is True


def test_is_expired_false_when_now_before_expiry():
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = datetime(2026, 8, 25, 9, 59, 59, tzinfo=UTC)
    assert is_expired(expires_at, now=now) is False


def test_is_expired_true_exactly_at_boundary():
    # Inclusive boundary -- a warrant is expired exactly at its expiry
    # instant, not only strictly after it.
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    assert is_expired(expires_at, now=expires_at) is True


def test_seconds_until_expiry_positive_before_expiry():
    expires_at = datetime(2026, 8, 25, 10, 1, tzinfo=UTC)
    now = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    assert seconds_until_expiry(expires_at, now=now) == 60


def test_seconds_until_expiry_negative_after_expiry():
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = datetime(2026, 8, 25, 10, 0, 30, tzinfo=UTC)
    assert seconds_until_expiry(expires_at, now=now) == -30
