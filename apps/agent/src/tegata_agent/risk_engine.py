"""
Risk scoring engine.

IMPORTANT CONTEXT: Xano is a no-code/visual backend (BaaS) — its actual
business logic lives in Xano's "Function Stack" builder inside your Xano
dashboard, not in a Python file. This module is NOT what runs in
production; it exists for two reasons:

1. A precise, testable reference specification of the scoring algorithm,
   so the logic can be validated with pytest *before* you manually
   recreate it step-by-step inside Xano's Function Stack. See
   docs/xano-setup.md for the exact steps to replicate this in Xano.
2. A local mock so agent-side (apps/agent) development and testing isn't
   blocked while waiting on Xano credentials/setup.

If you change the algorithm here, update docs/xano-setup.md AND the real
Xano Function Stack to match — they will silently drift otherwise, since
nothing can automatically keep a Python file and a no-code visual builder
in sync.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

# --- Configuration (mirror this table inside Xano as a "resource_tiers" table) ---

RESOURCE_SENSITIVITY: dict[str, int] = {
    "db_payment_prod": 50,
    "db_payment_staging": 20,
    "db_analytics_prod": 35,
    "server_web_prod": 40,
    "server_web_staging": 15,
    "internal_wiki": 5,
}
DEFAULT_RESOURCE_SENSITIVITY = 30  # used for any resource not in the table above

MAX_DURATION_FACTOR = 30
BUSINESS_HOURS_START = 8
BUSINESS_HOURS_END = 20
OFF_HOURS_PENALTY = 15
WEEKEND_PENALTY = 15

HIGH_RISK_HISTORY_LOOKBACK_DAYS = 30
HISTORY_PENALTY_PER_PRIOR_HIGH_RISK = 5
MAX_HISTORY_FACTOR = 15

HIGH_RISK_THRESHOLD = 70
MEDIUM_RISK_THRESHOLD = 40


@dataclass
class RequesterContext:
    """Mocked for the hackathon demo — in a real deployment this would come
    from Xano's own request history table, not be passed in manually."""

    prior_high_risk_requests_in_window: int = 0


@dataclass
class ScoreBreakdown:
    resource_sensitivity: int
    duration_factor: int
    time_of_day_factor: int
    requester_history_factor: int

    @property
    def total(self) -> int:
        return min(
            100,
            self.resource_sensitivity
            + self.duration_factor
            + self.time_of_day_factor
            + self.requester_history_factor,
        )


def score_resource_sensitivity(resource: str) -> int:
    return RESOURCE_SENSITIVITY.get(resource, DEFAULT_RESOURCE_SENSITIVITY)


def score_duration(requested_duration_minutes: int) -> int:
    """Longer requested durations contribute more risk, capped so this
    factor alone can never dominate the total score."""
    one_day_minutes = 24 * 60
    proportion = requested_duration_minutes / one_day_minutes
    return min(MAX_DURATION_FACTOR, round(proportion * MAX_DURATION_FACTOR))


def score_time_of_day(request_time: datetime) -> int:
    penalty = 0
    if request_time.weekday() >= 5:  # Saturday=5, Sunday=6
        penalty += WEEKEND_PENALTY
    if not (BUSINESS_HOURS_START <= request_time.hour < BUSINESS_HOURS_END):
        penalty += OFF_HOURS_PENALTY
    return penalty


def score_requester_history(context: RequesterContext) -> int:
    return min(
        MAX_HISTORY_FACTOR,
        context.prior_high_risk_requests_in_window * HISTORY_PENALTY_PER_PRIOR_HIGH_RISK,
    )


def tier_for_score(score: int) -> str:
    if score >= HIGH_RISK_THRESHOLD:
        return "high"
    if score >= MEDIUM_RISK_THRESHOLD:
        return "medium"
    return "low"


def compute_risk_score(
    resource: str,
    requested_duration_minutes: int,
    request_time: datetime | None = None,
    context: RequesterContext | None = None,
) -> tuple[int, str, ScoreBreakdown]:
    """Returns (score, tier, breakdown). This is the function whose output
    must match what the Xano Function Stack produces — see
    tests/test_risk_engine.py for the exact cases both must agree on."""
    request_time = request_time or datetime.now(UTC)
    context = context or RequesterContext()

    breakdown = ScoreBreakdown(
        resource_sensitivity=score_resource_sensitivity(resource),
        duration_factor=score_duration(requested_duration_minutes),
        time_of_day_factor=score_time_of_day(request_time),
        requester_history_factor=score_requester_history(context),
    )
    score = breakdown.total
    tier = tier_for_score(score)
    return score, tier, breakdown
