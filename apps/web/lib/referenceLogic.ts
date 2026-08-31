/**
 * TypeScript port of apps/agent/src/tegata_agent/{risk_engine,approval_rules,
 * state_machine,audit_log,ttl,warrant_verification}.py.
 *
 * PURPOSE: this file backs the /api/mock/* route handlers used in
 * NEXT_PUBLIC_API_MODE=mock (the default, and what Playwright's e2e tests
 * run against). It exists so Phase 6's UI and its e2e tests can fully
 * demonstrate the Core Flow — including the "different approver count for
 * high vs low risk" and "replay attack rejected" wow-moments — without
 * depending on the two Xano endpoints that don't exist yet (§9a, §9b in
 * docs/xano-setup.md).
 *
 * This is a PORT, not a reimplementation from scratch: every constant and
 * formula below is copied from the Python reference. If you change the
 * Python reference, update this file too, and update
 * apps/agent/tests/test_*.py first — that's still the source of truth.
 * This file has no test suite of its own; it is intentionally a thin,
 * literal mirror kept in sync by inspection, not an independent
 * implementation that could silently drift and still "pass its own tests."
 */

// ---------- risk_engine.py ----------

export const RESOURCE_SENSITIVITY: Record<string, number> = {
  db_payment_prod: 50,
  db_payment_staging: 20,
  db_analytics_prod: 35,
  server_web_prod: 40,
  server_web_staging: 15,
  internal_wiki: 5,
};
export const DEFAULT_RESOURCE_SENSITIVITY = 30;

export const MAX_DURATION_FACTOR = 30;
export const BUSINESS_HOURS_START = 8;
export const BUSINESS_HOURS_END = 20;
export const OFF_HOURS_PENALTY = 15;
export const WEEKEND_PENALTY = 15;

export const HISTORY_PENALTY_PER_PRIOR_HIGH_RISK = 5;
export const MAX_HISTORY_FACTOR = 15;

export const HIGH_RISK_THRESHOLD = 70;
export const MEDIUM_RISK_THRESHOLD = 40;

export type RiskTier = "low" | "medium" | "high";

export interface ScoreBreakdown {
  resource_sensitivity: number;
  duration_factor: number;
  time_of_day_factor: number;
  requester_history_factor: number;
}

export function scoreResourceSensitivity(resource: string): number {
  return RESOURCE_SENSITIVITY[resource] ?? DEFAULT_RESOURCE_SENSITIVITY;
}

export function scoreDuration(requestedDurationMinutes: number): number {
  const oneDayMinutes = 24 * 60;
  const proportion = requestedDurationMinutes / oneDayMinutes;
  return Math.min(MAX_DURATION_FACTOR, Math.round(proportion * MAX_DURATION_FACTOR));
}

export function scoreTimeOfDay(requestTime: Date): number {
  let penalty = 0;
  const day = requestTime.getUTCDay(); // 0=Sun ... 6=Sat
  const isWeekend = day === 0 || day === 6;
  if (isWeekend) penalty += WEEKEND_PENALTY;
  const hour = requestTime.getUTCHours();
  if (!(hour >= BUSINESS_HOURS_START && hour < BUSINESS_HOURS_END)) penalty += OFF_HOURS_PENALTY;
  return penalty;
}

export function scoreRequesterHistory(priorHighRiskRequestsInWindow: number): number {
  return Math.min(MAX_HISTORY_FACTOR, priorHighRiskRequestsInWindow * HISTORY_PENALTY_PER_PRIOR_HIGH_RISK);
}

export function tierForScore(score: number): RiskTier {
  if (score >= HIGH_RISK_THRESHOLD) return "high";
  if (score >= MEDIUM_RISK_THRESHOLD) return "medium";
  return "low";
}

export function computeRiskScore(
  resource: string,
  requestedDurationMinutes: number,
  requestTime: Date = new Date(),
  priorHighRiskRequestsInWindow = 0
): { score: number; tier: RiskTier; breakdown: ScoreBreakdown } {
  const breakdown: ScoreBreakdown = {
    resource_sensitivity: scoreResourceSensitivity(resource),
    duration_factor: scoreDuration(requestedDurationMinutes),
    time_of_day_factor: scoreTimeOfDay(requestTime),
    requester_history_factor: scoreRequesterHistory(priorHighRiskRequestsInWindow),
  };
  const score = Math.min(
    100,
    breakdown.resource_sensitivity +
      breakdown.duration_factor +
      breakdown.time_of_day_factor +
      breakdown.requester_history_factor
  );
  return { score, tier: tierForScore(score), breakdown };
}

// ---------- approval_rules.py ----------

export const APPROVAL_RULES: Record<RiskTier, { required_approver_count: number; max_duration_minutes: number }> = {
  high: { required_approver_count: 2, max_duration_minutes: 60 },
  medium: { required_approver_count: 1, max_duration_minutes: 240 },
  low: { required_approver_count: 1, max_duration_minutes: 1440 },
};

export interface ApprovalRequirement {
  required_approver_count: number;
  max_duration_minutes: number;
  duration_was_capped: boolean;
}

export function deriveApprovalRequirement(tier: RiskTier, requestedDurationMinutes: number): ApprovalRequirement {
  const rule = APPROVAL_RULES[tier];
  const effectiveMax = Math.min(requestedDurationMinutes, rule.max_duration_minutes);
  return {
    required_approver_count: rule.required_approver_count,
    max_duration_minutes: effectiveMax,
    duration_was_capped: effectiveMax < requestedDurationMinutes,
  };
}

// ---------- state_machine.py ----------

export type WarrantStatus =
  | "requested"
  | "scored"
  | "pending_approval"
  | "signed"
  | "active"
  | "expired"
  | "revoked"
  | "expired_unapproved";

export const VALID_TRANSITIONS: Record<WarrantStatus, WarrantStatus[]> = {
  requested: ["scored"],
  scored: ["pending_approval"],
  pending_approval: ["signed", "expired_unapproved"],
  signed: ["active"],
  active: ["expired", "revoked"],
  expired: [],
  revoked: [],
  expired_unapproved: [],
};

export class InvalidTransitionError extends Error {
  current: WarrantStatus;
  target: WarrantStatus;
  constructor(current: WarrantStatus, target: WarrantStatus) {
    super(`Cannot transition from '${current}' to '${target}'`);
    this.name = "InvalidTransitionError";
    this.current = current;
    this.target = target;
  }
}

export function validateTransition(current: WarrantStatus, target: WarrantStatus): void {
  if (!VALID_TRANSITIONS[current].includes(target)) {
    throw new InvalidTransitionError(current, target);
  }
}

// ---------- audit_log.py ----------

export interface AuditLogEntry {
  entry_id: string;
  warrant_id: string;
  event: string;
  timestamp: string; // canonical YYYY-MM-DDTHH:MM:SSZ
  actor: string | null;
  prev_hash: string | null;
  hash: string;
}

/** Canonical timestamp: whole-second UTC, explicit 'Z' — matches
 * audit_log.py's _canonical_timestamp exactly (NOT Date#toISOString(),
 * which includes milliseconds). */
export function canonicalTimestamp(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function sha256Hex(input: string): Promise<string> {
  // Works in both the Node route-handler runtime and the browser
  // (SubtleCrypto), avoiding an extra dependency.
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function contentHash(
  warrantId: string,
  event: string,
  timestamp: string,
  actor: string | null,
  prevHash: string | null
): Promise<string> {
  // Keys sorted to match json.dumps(..., sort_keys=True) in the Python reference.
  const payload = { actor, event, prev_hash: prevHash, timestamp, warrant_id: warrantId };
  const canonical = JSON.stringify(payload);
  return sha256Hex(canonical);
}

export async function appendAuditEntry(
  warrantId: string,
  event: string,
  entryId: string,
  previousEntry: AuditLogEntry | null,
  actor: string | null = null,
  timestamp: Date = new Date()
): Promise<AuditLogEntry> {
  const ts = canonicalTimestamp(timestamp);
  const prevHash = previousEntry ? previousEntry.hash : null;
  const hash = await contentHash(warrantId, event, ts, actor, prevHash);
  return { entry_id: entryId, warrant_id: warrantId, event, timestamp: ts, actor, prev_hash: prevHash, hash };
}

export class ChainIntegrityError extends Error {
  constructor(
    public index: number,
    public entryId: string
  ) {
    super(`Audit chain broken at index ${index} (entry_id=${entryId})`);
    this.name = "ChainIntegrityError";
  }
}

export async function verifyChain(entries: AuditLogEntry[]): Promise<void> {
  let previous: AuditLogEntry | null = null;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const expectedPrevHash = previous ? previous.hash : null;
    if (entry.prev_hash !== expectedPrevHash) throw new ChainIntegrityError(i, entry.entry_id);
    const recomputed = await contentHash(entry.warrant_id, entry.event, entry.timestamp, entry.actor, entry.prev_hash);
    if (recomputed !== entry.hash) throw new ChainIntegrityError(i, entry.entry_id);
    previous = entry;
  }
}

// ---------- ttl.py ----------

/** Mirrors ttl.compute_expires_at's DEMO_TTL_ACCELERATION_SECONDS concept:
 * accelerationSecondsPerMinute compresses each granted minute into that
 * many real seconds, so a demo doesn't require waiting real hours.
 * Default of 1 means "1 real second per granted minute." */
export function computeExpiresAt(activatedAt: Date, maxDurationMinutes: number, accelerationSecondsPerMinute = 1): Date {
  const realSeconds = maxDurationMinutes * accelerationSecondsPerMinute;
  return new Date(activatedAt.getTime() + realSeconds * 1000);
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return now.getTime() >= expiresAt.getTime();
}

// ---------- warrant_verification.py ----------

export class ReplayRejectedError extends Error {
  constructor(public warrantId: string) {
    super(`Warrant '${warrantId}' has already been used — replay rejected.`);
    this.name = "ReplayRejectedError";
  }
}

export class EnvelopeNotExecutedError extends Error {
  constructor(public envelopeStatus: string) {
    super(`Envelope is not yet fully executed (status=${envelopeStatus}).`);
    this.name = "EnvelopeNotExecutedError";
  }
}

export class SignatureMismatchError extends Error {
  constructor(public reason: string) {
    super(`Signature verification failed: ${reason}`);
    this.name = "SignatureMismatchError";
  }
}

export interface VerifyAndActivateInput {
  warrantId: string;
  currentStatus: WarrantStatus;
  used: boolean;
  envelopeStatus: string;
  expectedDocumentHash: string;
  returnedDocumentHash: string;
  expectedSignerEmail: string;
  signerEmail: string;
}

export function verifyAndActivate(input: VerifyAndActivateInput): { warrantId: string; newStatus: "active"; signerEmail: string } {
  if (input.used) throw new ReplayRejectedError(input.warrantId);
  if (input.envelopeStatus !== "EXECUTED") throw new EnvelopeNotExecutedError(input.envelopeStatus);
  if (input.returnedDocumentHash !== input.expectedDocumentHash) {
    throw new SignatureMismatchError("returned document hash does not match the version sent for signing");
  }
  if (input.signerEmail.trim().toLowerCase() !== input.expectedSignerEmail.trim().toLowerCase()) {
    throw new SignatureMismatchError(
      `signer '${input.signerEmail}' does not match expected approver '${input.expectedSignerEmail}'`
    );
  }
  validateTransition(input.currentStatus, "active");
  return { warrantId: input.warrantId, newStatus: "active", signerEmail: input.signerEmail };
}
