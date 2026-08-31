/**
 * In-memory mock backend for NEXT_PUBLIC_API_MODE=mock. Module-level state,
 * so it lives for the lifetime of one Next.js server process — resets on
 * restart. That's intentional and fine for a demo/e2e-test backend; it is
 * NOT a substitute for the real Xano workspace (see docs/xano-setup.md).
 *
 * Every state change goes through the exact same reference logic in
 * referenceLogic.ts that apps/agent/src/tegata_agent/*.py already has
 * pytest coverage for — this file is orchestration/storage around that
 * logic, not new business rules.
 */
import { AccessRequestSchema, type AccessRequest } from "@tegata/schema";
import {
  appendAuditEntry,
  computeExpiresAt,
  computeRiskScore,
  deriveApprovalRequirement,
  isExpired,
  type ApprovalRequirement,
  type AuditLogEntry,
  ReplayRejectedError,
  type RiskTier,
  type ScoreBreakdown,
  validateTransition,
  verifyAndActivate,
  type WarrantStatus,
} from "./referenceLogic";

export interface MockWarrant {
  warrant_id: string;
  request: AccessRequest;
  risk_score: { score: number; tier: RiskTier; factors: ScoreBreakdown };
  approval_requirement: ApprovalRequirement;
  status: WarrantStatus;
  used: boolean;
  document_hash: string;
  signatures: { email: string; signed_at: string }[];
  activated_at: string | null;
  expires_at: string | null;
  created_at: string;
}

const warrants = new Map<string, MockWarrant>();
const auditLogs = new Map<string, AuditLogEntry[]>();
let requesterHighRiskHistory = new Map<string, number>(); // requested_by -> count, demo-only

let nextId = 1;
function newId(prefix: string): string {
  return `${prefix}_${(nextId++).toString().padStart(4, "0")}`;
}

async function pushAuditEntry(warrantId: string, event: string, actor: string | null) {
  const chain = auditLogs.get(warrantId) ?? [];
  const previous = chain.length > 0 ? chain[chain.length - 1] : null;
  const entry = await appendAuditEntry(warrantId, event, newId("audit"), previous, actor);
  chain.push(entry);
  auditLogs.set(warrantId, chain);
  return entry;
}

/** Lazily applies the auto-expire sweep to a single warrant on read —
 * mirrors auto_expire.check_and_expire()'s "safe no-op unless active and
 * past expires_at" behavior, just triggered on-read instead of by a
 * scheduled task (there's no long-running process to schedule one in a
 * serverless-style route handler; polling on read is the pragmatic
 * equivalent for a demo). */
async function applyAutoExpireIfDue(warrant: MockWarrant): Promise<MockWarrant> {
  if (warrant.status !== "active" || !warrant.expires_at) return warrant;
  if (!isExpired(new Date(warrant.expires_at))) return warrant;
  validateTransition(warrant.status, "expired");
  warrant.status = "expired";
  await pushAuditEntry(warrant.warrant_id, "auto_expired", null);
  return warrant;
}

export async function createWarrant(rawRequest: unknown): Promise<MockWarrant> {
  const request = AccessRequestSchema.parse(rawRequest); // hard gate — same principle as nlu_frontdoor's validate_and_build_request

  const priorHighRisk = requesterHighRiskHistory.get(request.requested_by ?? "") ?? 0;
  const { score, tier, breakdown } = computeRiskScore(request.resource, request.requested_duration_minutes, new Date(), priorHighRisk);
  const approval = deriveApprovalRequirement(tier, request.requested_duration_minutes);

  if (tier === "high" && request.requested_by) {
    requesterHighRiskHistory.set(request.requested_by, priorHighRisk + 1);
  }

  const warrantId = newId("w");
  const documentHash = await sha256OfObject({ warrantId, request, score, tier });

  const warrant: MockWarrant = {
    warrant_id: warrantId,
    request,
    risk_score: { score, tier, factors: breakdown },
    approval_requirement: approval,
    status: "requested",
    used: false,
    document_hash: documentHash,
    signatures: [],
    activated_at: null,
    expires_at: null,
    created_at: new Date().toISOString(),
  };
  warrants.set(warrantId, warrant);

  // requested -> scored -> pending_approval, as two distinct audit entries
  // (matches docs/xano-setup.md §9b step 6 — don't collapse into one entry).
  await pushAuditEntry(warrantId, "requested", request.requested_by ?? null);
  validateTransition(warrant.status, "scored");
  warrant.status = "scored";
  await pushAuditEntry(warrantId, "scored", null);
  validateTransition(warrant.status, "pending_approval");
  warrant.status = "pending_approval";
  await pushAuditEntry(warrantId, "pending_approval", null);

  return warrant;
}

async function sha256OfObject(obj: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(obj));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function listWarrants(): Promise<MockWarrant[]> {
  const all = Array.from(warrants.values());
  for (const w of all) await applyAutoExpireIfDue(w);
  return all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

export async function getWarrant(warrantId: string): Promise<MockWarrant | undefined> {
  const w = warrants.get(warrantId);
  if (!w) return undefined;
  return applyAutoExpireIfDue(w);
}

export async function getAuditLog(warrantId: string): Promise<AuditLogEntry[]> {
  return auditLogs.get(warrantId) ?? [];
}

/** Simulates one approver signing via Foxit and the Xano §9a
 * /verify-signature endpoint reacting to it. In real Foxit, an envelope
 * isn't EXECUTED until every required party has signed — modeled here by
 * only calling verify_and_activate once signatures.length reaches
 * required_approver_count. */
export async function signWarrant(warrantId: string, signerEmail: string): Promise<MockWarrant> {
  const warrant = warrants.get(warrantId);
  if (!warrant) throw new Error(`No such warrant: ${warrantId}`);

  // Anti-replay fires here, before anything else about this sign attempt
  // is even considered — same ordering as warrant_verification.py.
  if (warrant.used) {
    throw new ReplayRejectedError(warrantId);
  }

  if (warrant.status === "pending_approval") {
    validateTransition(warrant.status, "signed");
    warrant.status = "signed";
  }

  warrant.signatures.push({ email: signerEmail, signed_at: new Date().toISOString() });
  await pushAuditEntry(warrantId, "signature_collected", signerEmail);

  const envelopeStatus = warrant.signatures.length >= warrant.approval_requirement.required_approver_count ? "EXECUTED" : "SENT";

  if (envelopeStatus !== "EXECUTED") {
    return warrant; // still waiting on more required approvers
  }

  const result = verifyAndActivate({
    warrantId,
    currentStatus: warrant.status,
    used: warrant.used,
    envelopeStatus,
    expectedDocumentHash: warrant.document_hash,
    returnedDocumentHash: warrant.document_hash, // mock: no real tampering channel to simulate
    expectedSignerEmail: signerEmail, // mock: no real RBAC directory of "the" expected approver
    signerEmail,
  });

  warrant.used = true;
  warrant.status = result.newStatus;
  warrant.activated_at = new Date().toISOString();
  warrant.expires_at = computeExpiresAt(new Date(warrant.activated_at), warrant.approval_requirement.max_duration_minutes, 1).toISOString();
  await pushAuditEntry(warrantId, "signed_and_activated", signerEmail);

  return warrant;
}

/** Test-only escape hatch so Playwright can reset state between specs
 * without restarting the dev server. Not exposed outside /api/mock. */
export function __resetMockStoreForTests(): void {
  warrants.clear();
  auditLogs.clear();
  requesterHighRiskHistory = new Map();
  nextId = 1;
}
