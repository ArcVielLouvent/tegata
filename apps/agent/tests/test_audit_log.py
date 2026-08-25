from datetime import UTC, datetime

import pytest

from tegata_agent.audit_log import ChainIntegrityError, append_entry, verify_chain


def test_first_entry_has_null_prev_hash():
    entry = append_entry(
        warrant_id="w1",
        event="requested",
        entry_id="e1",
        previous_entry=None,
        timestamp=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
    )
    assert entry.prev_hash is None
    assert entry.hash  # non-empty


def test_second_entry_links_to_first():
    e1 = append_entry(
        warrant_id="w1",
        event="requested",
        entry_id="e1",
        previous_entry=None,
        timestamp=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
    )
    e2 = append_entry(
        warrant_id="w1",
        event="scored",
        entry_id="e2",
        previous_entry=e1,
        timestamp=datetime(2026, 8, 25, 10, 1, tzinfo=UTC),
    )
    assert e2.prev_hash == e1.hash


def test_same_content_produces_same_hash_deterministically():
    ts = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    e1a = append_entry(
        warrant_id="w1", event="requested", entry_id="e1", previous_entry=None, timestamp=ts
    )
    e1b = append_entry(
        warrant_id="w1", event="requested", entry_id="e1", previous_entry=None, timestamp=ts
    )
    assert e1a.hash == e1b.hash


def test_different_event_produces_different_hash():
    ts = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    e1 = append_entry(
        warrant_id="w1", event="requested", entry_id="e1", previous_entry=None, timestamp=ts
    )
    e2 = append_entry(
        warrant_id="w1", event="scored", entry_id="e1", previous_entry=None, timestamp=ts
    )
    assert e1.hash != e2.hash


def test_different_actor_produces_different_hash():
    ts = datetime(2026, 8, 25, 10, 0, tzinfo=UTC)
    e1 = append_entry(
        warrant_id="w1", event="signed", entry_id="e1", previous_entry=None,
        actor="alice", timestamp=ts,
    )
    e2 = append_entry(
        warrant_id="w1", event="signed", entry_id="e1", previous_entry=None,
        actor="bob", timestamp=ts,
    )
    assert e1.hash != e2.hash


def test_verify_chain_passes_for_intact_chain():
    e1 = append_entry(
        warrant_id="w1", event="requested", entry_id="e1", previous_entry=None,
        timestamp=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
    )
    e2 = append_entry(
        warrant_id="w1", event="scored", entry_id="e2", previous_entry=e1,
        timestamp=datetime(2026, 8, 25, 10, 1, tzinfo=UTC),
    )
    e3 = append_entry(
        warrant_id="w1", event="signed", entry_id="e3", previous_entry=e2,
        timestamp=datetime(2026, 8, 25, 10, 2, tzinfo=UTC),
    )
    verify_chain([e1, e2, e3])  # should not raise


def test_verify_chain_detects_tampered_field():
    """The actual demo moment (docs/tegata-concept.md Stretch C, built on
    top of this primitive): manually corrupt one field of a stored entry
    -- simulating a DB admin editing a row directly -- and confirm it's
    caught rather than silently accepted."""
    e1 = append_entry(
        warrant_id="w1", event="requested", entry_id="e1", previous_entry=None,
        timestamp=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
    )
    e2 = append_entry(
        warrant_id="w1", event="scored", entry_id="e2", previous_entry=e1,
        timestamp=datetime(2026, 8, 25, 10, 1, tzinfo=UTC),
    )

    tampered_e1 = e1.model_copy(update={"event": "requested_TAMPERED"})

    with pytest.raises(ChainIntegrityError) as exc_info:
        verify_chain([tampered_e1, e2])
    assert exc_info.value.index == 0


def test_verify_chain_detects_broken_link():
    e1 = append_entry(
        warrant_id="w1", event="requested", entry_id="e1", previous_entry=None,
        timestamp=datetime(2026, 8, 25, 10, 0, tzinfo=UTC),
    )
    e2 = append_entry(
        warrant_id="w1", event="scored", entry_id="e2", previous_entry=e1,
        timestamp=datetime(2026, 8, 25, 10, 1, tzinfo=UTC),
    )
    # An entry whose prev_hash points to nothing, spliced in after e2 --
    # its own hash is internally valid, but the chain linkage is broken.
    e3_orphan = append_entry(
        warrant_id="w1", event="signed", entry_id="e3", previous_entry=None,
        timestamp=datetime(2026, 8, 25, 10, 2, tzinfo=UTC),
    )

    with pytest.raises(ChainIntegrityError) as exc_info:
        verify_chain([e1, e2, e3_orphan])
    assert exc_info.value.index == 2


def test_verify_chain_empty_list_is_fine():
    verify_chain([])  # no entries, nothing to break -- should not raise
