import pytest

from tegata_agent.state_machine import (
    ALL_STATUSES,
    InvalidTransitionError,
    is_terminal,
    validate_transition,
)


def test_happy_path_sequence_is_valid():
    sequence = ["requested", "scored", "pending_approval", "signed", "active", "expired"]
    for current, target in zip(sequence, sequence[1:], strict=False):
        validate_transition(current, target)  # should not raise


def test_high_risk_unapproved_path_is_valid():
    validate_transition("pending_approval", "expired_unapproved")


def test_active_can_be_revoked():
    validate_transition("active", "revoked")


@pytest.mark.parametrize(
    "current,target",
    [
        ("requested", "active"),  # cannot skip scoring/approval entirely
        ("scored", "signed"),  # cannot skip pending_approval
        ("pending_approval", "active"),  # cannot skip the signed step
        ("expired", "active"),  # cannot revive a terminal state
        ("revoked", "active"),  # cannot revive a terminal state
        ("expired_unapproved", "pending_approval"),  # cannot restart from a terminal state
        ("active", "requested"),  # no going backwards
    ],
)
def test_invalid_transitions_are_rejected(current, target):
    with pytest.raises(InvalidTransitionError):
        validate_transition(current, target)


def test_unknown_status_raises_value_error():
    with pytest.raises(ValueError):
        validate_transition("nonexistent_status", "scored")
    with pytest.raises(ValueError):
        validate_transition("requested", "nonexistent_status")


@pytest.mark.parametrize("status", ["expired", "revoked", "expired_unapproved"])
def test_terminal_statuses(status):
    assert is_terminal(status) is True


@pytest.mark.parametrize(
    "status", ["requested", "scored", "pending_approval", "signed", "active"]
)
def test_non_terminal_statuses(status):
    assert is_terminal(status) is False


def test_all_statuses_matches_schema_enum():
    # Keep in sync with WarrantStatus in packages/schema/python/models.py
    # and tegata.schema.json — this is a cheap early warning if they drift.
    expected = {
        "requested",
        "scored",
        "pending_approval",
        "signed",
        "active",
        "expired",
        "revoked",
        "expired_unapproved",
    }
    assert ALL_STATUSES == expected
