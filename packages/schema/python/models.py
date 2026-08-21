"""
Pydantic models mirroring packages/schema/tegata.schema.json.

These are the canonical Python-side data shapes used by apps/agent.
If you change this file, update tegata.schema.json (and packages/schema/ts/schema.ts)
to match, and re-run tests/test_schema_consistency.py.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class RiskTier(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class WarrantStatus(str, Enum):
    REQUESTED = "requested"
    SCORED = "scored"
    PENDING_APPROVAL = "pending_approval"
    SIGNED = "signed"
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    EXPIRED_UNAPPROVED = "expired_unapproved"


class AccessRequest(BaseModel):
    resource: str = Field(
        ...,
        description="Must match an entry in the registered resource whitelist. "
        "Never trust free-text resource names directly.",
    )
    reason: str = Field(..., min_length=1, max_length=500)
    requested_duration_minutes: int = Field(..., ge=1, le=1440)
    ticket_ref: Optional[str] = None
    requested_by: Optional[str] = None

    model_config = {"extra": "forbid"}


class RiskFactors(BaseModel):
    resource_sensitivity: int = 0
    duration_factor: int = 0
    time_of_day_factor: int = 0
    requester_history_factor: int = 0


class RiskScore(BaseModel):
    score: int = Field(..., ge=0, le=100)
    tier: RiskTier
    factors: RiskFactors

    model_config = {"extra": "forbid"}

    @field_validator("tier")
    @classmethod
    def tier_matches_score(cls, v: RiskTier, info):
        # Cross-check happens in the risk engine, not here — this validator
        # intentionally only enforces the enum shape. Business-rule
        # consistency (e.g. score 90 must be tier "high") is tested in
        # tests/test_risk_engine.py once Phase 1 logic lands.
        return v


class ApprovalRequirement(BaseModel):
    required_approver_count: int = Field(..., ge=1, le=2)
    max_duration_minutes: int = Field(..., ge=1)

    model_config = {"extra": "forbid"}


class Warrant(BaseModel):
    warrant_id: str
    request: AccessRequest
    risk_score: RiskScore
    approval_requirement: ApprovalRequirement
    status: WarrantStatus
    used: bool = False
    document_url: Optional[str] = None
    expires_at: Optional[datetime] = None

    model_config = {"extra": "forbid"}


class AuditLogEntry(BaseModel):
    entry_id: str
    warrant_id: str
    event: str
    timestamp: datetime
    actor: Optional[str] = None
    prev_hash: Optional[str] = None
    hash: str

    model_config = {"extra": "forbid"}
