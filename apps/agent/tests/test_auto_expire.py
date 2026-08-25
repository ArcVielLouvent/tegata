from datetime import UTC, datetime, timedelta

import pytest

from tegata_agent.audit_log import append_entry
from tegata_agent.auto_expire import check_and_expire
from tegata_agent.ttl import compute_expires_at


def test_active_warrant_past_expiry_transitions_to_expired():
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = expires_at + timedelta(seconds=1)

    result = check_and_expire(
        warrant_id="w1",
        current_status="active",
        expires_at=expires_at,
        previous_audit_entry=None,
        now=now,
        entry_id_factory=lambda: "e-fixed",
    )

    assert result.should_expire is True
    assert result.new_status == "expired"
    assert result.audit_entry is not None
    assert result.audit_entry.event == "auto_expired"
    assert result.audit_entry.actor is None  # system-triggered, no human
    assert result.audit_entry.entry_id == "e-fixed"


def test_active_warrant_before_expiry_does_not_expire():
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = expires_at - timedelta(seconds=1)

    result = check_and_expire(
        warrant_id="w1",
        current_status="active",
        expires_at=expires_at,
        previous_audit_entry=None,
        now=now,
    )

    assert result.should_expire is False
    assert result.new_status is None
    assert result.audit_entry is None


def test_active_warrant_exactly_at_expiry_boundary_transitions():
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)

    result = check_and_expire(
        warrant_id="w1",
        current_status="active",
        expires_at=expires_at,
        previous_audit_entry=None,
        now=expires_at,
    )

    assert result.should_expire is True


@pytest.mark.parametrize(
    "status",
    [
        "requested",
        "scored",
        "pending_approval",
        "signed",
        "expired",
        "revoked",
        "expired_unapproved",
    ],
)
def test_non_active_status_never_expires_even_if_time_passed(status):
    """Safety check: this function will be called repeatedly (e.g. every
    ~10-15 seconds from a Xano scheduled task sweeping all warrants) --
    calling it on a warrant that's already terminal, or hasn't reached
    'active' yet, must always be a safe no-op, never an error."""
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = expires_at + timedelta(days=1)  # well past, regardless of status

    result = check_and_expire(
        warrant_id="w1",
        current_status=status,
        expires_at=expires_at,
        previous_audit_entry=None,
        now=now,
    )

    assert result.should_expire is False
    assert result.new_status is None
    assert result.audit_entry is None


def test_audit_entry_links_to_previous_entry_in_chain():
    ts0 = datetime(2026, 8, 25, 9, 0, tzinfo=UTC)
    prior = append_entry(
        warrant_id="w1", event="signed", entry_id="e-prior", previous_entry=None, timestamp=ts0
    )

    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = expires_at + timedelta(seconds=1)

    result = check_and_expire(
        warrant_id="w1",
        current_status="active",
        expires_at=expires_at,
        previous_audit_entry=prior,
        now=now,
        entry_id_factory=lambda: "e-expire",
    )

    assert result.audit_entry.prev_hash == prior.hash


def test_repeated_calls_after_expiry_stay_safe_no_ops():
    """Simulates a scheduled task sweeping the same already-expired
    warrant on multiple ticks -- must not attempt a second "expired ->
    expired" transition (state_machine correctly has no such edge)."""
    expires_at = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    now = expires_at + timedelta(seconds=30)

    result = check_and_expire(
        warrant_id="w1",
        current_status="expired",  # already transitioned by an earlier tick
        expires_at=expires_at,
        previous_audit_entry=None,
        now=now,
    )

    assert result.should_expire is False


def test_end_to_end_accelerated_ttl_demo_scenario():
    """ROADMAP.md Phase 5 'done when' criteria: the full active ->
    auto-expire cycle recorded quickly for a demo, using an accelerated
    TTL instead of waiting real minutes (ROADMAP.md's own example: 15
    real seconds standing in for a real accelerated window)."""
    activated_at = datetime(2026, 8, 25, 12, 0, 0, tzinfo=UTC)
    # 15-minute grant, accelerated so 1 requested minute = 1 real second
    expires_at = compute_expires_at(
        activated_at, max_duration_minutes=15, acceleration_seconds_per_minute=1
    )
    assert expires_at == activated_at + timedelta(seconds=15)

    # 14 seconds in: still active, no human action taken
    still_active = check_and_expire(
        warrant_id="w1",
        current_status="active",
        expires_at=expires_at,
        previous_audit_entry=None,
        now=activated_at + timedelta(seconds=14),
    )
    assert still_active.should_expire is False

    # 16 seconds in: auto-expired, no human action taken
    now_expired = check_and_expire(
        warrant_id="w1",
        current_status="active",
        expires_at=expires_at,
        previous_audit_entry=None,
        now=activated_at + timedelta(seconds=16),
    )
    assert now_expired.should_expire is True
    assert now_expired.new_status == "expired"
    assert now_expired.audit_entry.actor is None
