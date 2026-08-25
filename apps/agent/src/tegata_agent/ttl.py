"""
TTL / auto-expire timing policy.

Reference implementation mirroring what a Xano scheduled task must do
(see docs/xano-setup.md, Phase 5 section): given an active warrant's
activation timestamp and its approval_requirement's max_duration_minutes
(Phase 1 output), compute when it should expire, and whether "now" has
already crossed that point.

DEMO_TTL_ACCELERATION_SECONDS (see .env.example) is what makes the full
"request -> active -> auto-expire, with zero human action" cycle
recordable quickly for the demo video (ROADMAP.md Phase 5 "done when"
criteria): instead of waiting real minutes, pass an acceleration factor
that compresses each requested minute into that many real seconds.
"""
from __future__ import annotations

from datetime import UTC, datetime, timedelta


def compute_expires_at(
    activated_at: datetime,
    max_duration_minutes: int,
    acceleration_seconds_per_minute: float | None = None,
) -> datetime:
    """Returns the timestamp at which an active warrant should expire.

    If acceleration_seconds_per_minute is None (default), uses real
    minutes -- production behavior. If set (demo mode), each requested
    minute is compressed into that many real seconds instead, e.g.
    acceleration_seconds_per_minute=1 turns a 15-minute grant into a
    15-second real-world window.
    """
    if max_duration_minutes <= 0:
        raise ValueError("max_duration_minutes must be positive")

    if acceleration_seconds_per_minute is None:
        delta = timedelta(minutes=max_duration_minutes)
    else:
        if acceleration_seconds_per_minute <= 0:
            raise ValueError("acceleration_seconds_per_minute must be positive")
        delta = timedelta(seconds=max_duration_minutes * acceleration_seconds_per_minute)

    return activated_at + delta


def is_expired(expires_at: datetime, now: datetime | None = None) -> bool:
    """True once `now` has reached or passed expires_at (inclusive, so a
    warrant is considered expired exactly at its expiry boundary, not
    only strictly after it)."""
    now = now or datetime.now(UTC)
    return now >= expires_at


def seconds_until_expiry(expires_at: datetime, now: datetime | None = None) -> float:
    """Positive while still active, negative once past expiry. Useful for
    a UI countdown (Phase 6) without duplicating this arithmetic there."""
    now = now or datetime.now(UTC)
    return (expires_at - now).total_seconds()
