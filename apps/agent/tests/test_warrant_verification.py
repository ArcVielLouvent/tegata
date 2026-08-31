import pytest

from tegata_agent.state_machine import InvalidTransitionError
from tegata_agent.warrant_verification import (
    EnvelopeNotExecutedError,
    ReplayRejectedError,
    SignatureMismatchError,
    verify_and_activate,
)

VALID_KWARGS = dict(
    warrant_id="w1",
    current_status="signed",
    used=False,
    envelope_status="EXECUTED",
    expected_document_hash="abc123",
    returned_document_hash="abc123",
    expected_signer_email="approver@example.com",
    signer_email="approver@example.com",
)


def test_happy_path_activates():
    result = verify_and_activate(**VALID_KWARGS)
    assert result.warrant_id == "w1"
    assert result.new_status == "active"
    assert result.signer_email == "approver@example.com"


def test_signer_email_is_case_insensitive():
    kwargs = {**VALID_KWARGS, "signer_email": "Approver@Example.com"}
    result = verify_and_activate(**kwargs)
    assert result.new_status == "active"


def test_replay_rejected_when_already_used():
    kwargs = {**VALID_KWARGS, "used": True}
    with pytest.raises(ReplayRejectedError) as exc_info:
        verify_and_activate(**kwargs)
    assert exc_info.value.warrant_id == "w1"


def test_replay_check_runs_before_envelope_is_even_inspected():
    """Anti-replay must fire on the warrant's own state, regardless of
    what the (possibly attacker-supplied) envelope claims."""
    kwargs = {
        **VALID_KWARGS,
        "used": True,
        "envelope_status": "EXECUTED",
        "returned_document_hash": "abc123",
        "signer_email": "approver@example.com",
    }
    with pytest.raises(ReplayRejectedError):
        verify_and_activate(**kwargs)


@pytest.mark.parametrize("bad_status", ["SENT", "VIEWED", "DECLINED", "VOIDED"])
def test_envelope_not_executed_rejected(bad_status):
    kwargs = {**VALID_KWARGS, "envelope_status": bad_status}
    with pytest.raises(EnvelopeNotExecutedError) as exc_info:
        verify_and_activate(**kwargs)
    assert exc_info.value.envelope_status == bad_status


def test_document_hash_mismatch_rejected():
    kwargs = {**VALID_KWARGS, "returned_document_hash": "tampered-hash"}
    with pytest.raises(SignatureMismatchError):
        verify_and_activate(**kwargs)


def test_signer_email_mismatch_rejected():
    kwargs = {**VALID_KWARGS, "signer_email": "attacker@example.com"}
    with pytest.raises(SignatureMismatchError):
        verify_and_activate(**kwargs)


@pytest.mark.parametrize(
    "bad_current_status",
    ["requested", "scored", "pending_approval", "active", "expired", "revoked"],
)
def test_invalid_current_status_rejected_by_state_machine(bad_current_status):
    """This function must not duplicate state_machine's transition rules —
    it delegates, so any status other than 'signed' is rejected the same
    way it would be anywhere else in the project."""
    kwargs = {**VALID_KWARGS, "current_status": bad_current_status}
    with pytest.raises(InvalidTransitionError):
        verify_and_activate(**kwargs)


def test_all_checks_pass_independently_of_each_other():
    """Sanity check that flipping exactly one field at a time is what
    trips each specific error, not some unrelated interaction."""
    base = dict(VALID_KWARGS)
    # Confirm the base case truly is valid before testing single mutations
    verify_and_activate(**base)

    mutations_and_errors = [
        ({"used": True}, ReplayRejectedError),
        ({"envelope_status": "SENT"}, EnvelopeNotExecutedError),
        ({"returned_document_hash": "x"}, SignatureMismatchError),
        ({"signer_email": "someone-else@example.com"}, SignatureMismatchError),
    ]
    for mutation, expected_error in mutations_and_errors:
        with pytest.raises(expected_error):
            verify_and_activate(**{**base, **mutation})
