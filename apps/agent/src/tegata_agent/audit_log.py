"""
Audit log — hash-chained entries.

Reference implementation mirroring what Xano's Function Stack must build
(see docs/xano-setup.md, Phase 5 section). Every entry stores the hash of
the immediately preceding entry (prev_hash) plus a hash of its own
content (hash). Those two fields are already REQUIRED by the schema
(AuditLogEntry.prev_hash / .hash — see packages/schema/tegata.schema.json),
so this is base Phase 5 scope, not the Phase 7 "Stretch C" feature.

SCOPE NOTE: this module builds hash-chained entries and can verify a
chain is intact (verify_chain). What's still Phase 7 scope per
ROADMAP.md is the live demo moment of *deliberately* corrupting a stored
row in the real Xano table and showing the corruption caught on camera —
that's a demo/product feature built on top of the primitive here, not a
change to the hashing logic itself.

Chains are scoped per-warrant (each warrant's own audit trail is its own
chain, starting from prev_hash=None) — simplest model for the demo and
matches how a UI would realistically want to display "history for this
one request," rather than one giant global chain across every warrant.
"""
from __future__ import annotations

import hashlib
import json
from datetime import UTC, datetime

from models import AuditLogEntry  # packages/schema/python, see pyproject.toml pythonpath


def _content_hash(
    warrant_id: str,
    event: str,
    timestamp: datetime,
    actor: str | None,
    prev_hash: str | None,
) -> str:
    """Deterministic content representation, hashed with SHA-256. Keys
    are sorted and separators fixed so the same logical entry always
    produces the same hash regardless of incidental dict ordering."""
    payload = {
        "warrant_id": warrant_id,
        "event": event,
        "timestamp": timestamp.isoformat(),
        "actor": actor,
        "prev_hash": prev_hash,
    }
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def append_entry(
    warrant_id: str,
    event: str,
    entry_id: str,
    previous_entry: AuditLogEntry | None,
    actor: str | None = None,
    timestamp: datetime | None = None,
) -> AuditLogEntry:
    """Builds the next AuditLogEntry in a warrant's chain.

    previous_entry=None is only correct for the very first entry ever
    logged for this warrant_id (schema requires prev_hash to be null only
    for that first entry — see AuditLogEntry.prev_hash's description in
    tegata.schema.json)."""
    timestamp = timestamp or datetime.now(UTC)
    prev_hash = previous_entry.hash if previous_entry else None

    content_hash = _content_hash(warrant_id, event, timestamp, actor, prev_hash)

    return AuditLogEntry(
        entry_id=entry_id,
        warrant_id=warrant_id,
        event=event,
        timestamp=timestamp,
        actor=actor,
        prev_hash=prev_hash,
        hash=content_hash,
    )


class ChainIntegrityError(Exception):
    def __init__(self, index: int, entry_id: str):
        super().__init__(
            f"Audit chain broken at index {index} (entry_id={entry_id}): "
            "recomputed content hash does not match the entry's stored "
            "hash, or its prev_hash does not match the previous entry's "
            "hash."
        )
        self.index = index
        self.entry_id = entry_id


def verify_chain(entries: list[AuditLogEntry]) -> None:
    """Raises ChainIntegrityError at the first entry (in list order) whose
    stored hash doesn't match a fresh recomputation, or whose prev_hash
    doesn't correctly link to the entry before it. Returns None (silently)
    if the whole chain is intact, including for an empty list."""
    previous: AuditLogEntry | None = None
    for i, entry in enumerate(entries):
        expected_prev_hash = previous.hash if previous else None
        if entry.prev_hash != expected_prev_hash:
            raise ChainIntegrityError(i, entry.entry_id)

        recomputed = _content_hash(
            entry.warrant_id, entry.event, entry.timestamp, entry.actor, entry.prev_hash
        )
        if recomputed != entry.hash:
            raise ChainIntegrityError(i, entry.entry_id)

        previous = entry
