/**
 * Single point where the UI decides whether it's talking to the local
 * mock backend or a real Xano workspace. Pages never call fetch() directly
 * against either target — everything goes through here, so flipping
 * NEXT_PUBLIC_API_MODE is the only thing that has to change.
 *
 * XANO MODE — confirmed contract as of 2026-08-28 (verified against the
 * live workspace via Xano's own AI agent, not guessed):
 *
 *   - Create: POST /score. This is NOT a separate /warrants endpoint
 *     (docs/xano-setup.md's earlier §9b spec was wrong about this — /score
 *     already persists a `requests` row AND a `warrants` row, and now also
 *     populates warrants.document_hash + warrants.approver_email).
 *   - Sign/activate: POST /warrants/transition with
 *     { warrant_id, to_status, envelope_status?, returned_document_hash?,
 *       signer_email? }. The last three are only enforced when
 *       to_status === "active" (the signature-verification path); for
 *       every other transition they're ignored.
 *   - Xano wraps ALL precondition-thrown errors as
 *     { message: { error: "<code>", warrant_id?: "..." } } — one level
 *     deeper than this app's own /api/mock/* routes return. normalizeError()
 *     below unwraps this and maps known codes to the SAME human-readable
 *     text referenceLogic.ts's error classes use, so the UI shows
 *     identical messages regardless of which mode it's running in.
 *   - Xano's warrant record shape for fields this UI reads (risk tier,
 *     approval requirement, signature progress) has NOT been fully
 *     confirmed field-by-field against a real GET /warrants response yet
 *     — normalizeWarrant() below is a best-effort adapter with safe
 *     fallbacks so the UI doesn't crash on an unexpected shape, not a
 *     guarantee every value is correctly mapped. Multi-approver progress
 *     (warrant.signatures) has NO Xano equivalent at all — real approver
 *     counting happens inside the Foxit envelope (multiple recipients),
 *     not as a field Xano tracks per signature. In xano mode this UI
 *     treats a warrant as fully signed as soon as one /warrants/transition
 *     call to "active" succeeds — it cannot show "1 of 2 signed" the way
 *     mock mode's simulated flow does. Treat xano-mode testing as a
 *     single-approver-envelope smoke test until this is revisited.
 */
import type { AccessRequest } from "@tegata/schema";
import type { MockWarrant } from "./mockStore";

const MODE = (process.env.NEXT_PUBLIC_API_MODE || "mock") as "mock" | "xano";
const XANO_BASE = process.env.NEXT_PUBLIC_XANO_API_BASE_URL || "";

const ERROR_MESSAGES: Record<string, (body: any) => string> = {
  replay_rejected: (b) => `Warrant '${b?.warrant_id ?? "?"}' has already been used — replay rejected.`,
  envelope_not_executed: (b) => `Envelope is not yet fully executed (status=${b?.envelope_status ?? "unknown"}).`,
  signature_mismatch: () => "Signature verification failed: document hash or signer does not match what was sent for signature.",
  invalid_transition: (b) => `Cannot transition from '${b?.current ?? "?"}' to '${b?.target ?? "?"}'`,
  not_found: () => "No such warrant.",
  validation_failed: () => "Request validation failed.",
};

/** Unwraps Xano's `{message: {error, ...}}` precondition-error shape
 * (confirmed 2026-08-28) into the same flat shape this app's own
 * /api/mock/* routes already return, and maps known error codes to the
 * exact same human-readable strings referenceLogic.ts's error classes
 * produce — so ApiError.message is identical text in both modes. */
function normalizeErrorBody(body: any): any {
  const inner = body && typeof body.message === "object" && body.message !== null ? body.message : body;
  return inner || {};
}

export class ApiError extends Error {
  code?: string;
  constructor(
    public status: number,
    public body: any
  ) {
    const normalized = normalizeErrorBody(body);
    const code = normalized?.error;
    const humanize = code && ERROR_MESSAGES[code];
    const explicitMessage = typeof normalized?.message === "string" ? normalized.message : undefined;
    super(explicitMessage || (humanize ? humanize(normalized) : undefined) || code || `Request failed with status ${status}`);
    this.code = code;
    this.body = normalized;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const base = MODE === "mock" ? "/api/mock" : XANO_BASE;
  if (MODE === "xano" && !base) {
    throw new ApiError(0, { error: "config_error", message: "NEXT_PUBLIC_XANO_API_BASE_URL is not set" });
  }
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Best-effort adapter for a real Xano warrant record into the shape this
 * UI already renders (MockWarrant-ish). Every read is defensive with a
 * fallback, because the exact Xano response shape hasn't been confirmed
 * field-by-field yet — see the module docstring. No-op in mock mode. */
function normalizeWarrant(raw: any): MockWarrant {
  if (MODE === "mock") return raw as MockWarrant;

  const score = raw.risk_score?.score ?? raw.risk_score ?? raw.score ?? 0;
  const tier = raw.risk_score?.tier ?? raw.risk_tier ?? raw.tier ?? "low";
  const requiredApprovers = raw.approval_requirement?.required_approver_count ?? raw.required_approver_count ?? 1;
  const maxDuration = raw.approval_requirement?.max_duration_minutes ?? raw.max_duration_minutes ?? raw.requested_duration_minutes ?? 0;

  return {
    warrant_id: raw.warrant_id ?? raw.id,
    request: {
      resource: raw.resource ?? raw.request?.resource ?? "",
      reason: raw.reason ?? raw.request?.reason ?? "",
      requested_duration_minutes: raw.requested_duration_minutes ?? raw.request?.requested_duration_minutes ?? 0,
      requested_by: raw.requested_by ?? raw.request?.requested_by,
    },
    risk_score: {
      score,
      tier,
      factors: raw.risk_score?.factors ?? { resource_sensitivity: 0, duration_factor: 0, time_of_day_factor: 0, requester_history_factor: 0 },
    },
    approval_requirement: {
      required_approver_count: requiredApprovers,
      max_duration_minutes: maxDuration,
      duration_was_capped: raw.approval_requirement?.duration_was_capped ?? false,
    },
    status: raw.status,
    used: raw.used ?? raw.status === "active",
    document_hash: raw.document_hash ?? "",
    // Xano has no per-signature tracking (see module docstring) — once
    // status is "active" we can only infer "fully signed", not a running
    // count, so we report it as fully satisfied rather than fabricate a
    // count we don't have.
    signatures: raw.status === "active" ? [{ email: raw.approver_email ?? "unknown", signed_at: raw.updated_at ?? new Date().toISOString() }] : [],
    activated_at: raw.activated_at ?? null,
    expires_at: raw.expires_at ?? null,
    created_at: raw.created_at ?? new Date().toISOString(),
  } as MockWarrant;
}

export async function listWarrants(): Promise<{ warrants: MockWarrant[] }> {
  const result = await request<{ warrants: any[] }>("/warrants", { method: "GET" });
  return { warrants: (result.warrants || []).map(normalizeWarrant) };
}

export async function getWarrant(warrantId: string): Promise<{ warrant: MockWarrant }> {
  const path = MODE === "mock" ? `/warrants/${warrantId}` : `/warrants/${warrantId}`;
  const result = await request<{ warrant: any }>(path, { method: "GET" });
  return { warrant: normalizeWarrant(result.warrant) };
}

export async function createWarrant(accessRequest: AccessRequest): Promise<{ warrant: MockWarrant }> {
  // Real Xano target: POST /score — confirmed 2026-08-28 to already
  // persist the warrant itself (contrary to this file's earlier
  // assumption of a separate POST /warrants endpoint).
  const path = MODE === "mock" ? "/warrants" : "/score";
  const result = await request<{ warrant: any }>(path, { method: "POST", body: JSON.stringify(accessRequest) });
  return { warrant: normalizeWarrant(result.warrant) };
}

export async function signWarrant(warrantId: string, signerEmail: string): Promise<{ warrant: MockWarrant }> {
  if (MODE === "mock") {
    const result = await request<{ warrant: any }>(`/warrants/${warrantId}/sign`, {
      method: "POST",
      body: JSON.stringify({ signer_email: signerEmail, warrant_id: warrantId }),
    });
    return { warrant: normalizeWarrant(result.warrant) };
  }

  // Real Xano: POST /warrants/transition, confirmed 2026-08-28. The
  // signature-verification path (to_status="active") checks
  // returned_document_hash against warrants.document_hash — in the
  // absence of a real Foxit round-trip wired into this UI yet, we fetch
  // the warrant's own document_hash first and send it back unchanged
  // (i.e. "no tampering occurred"), and hardcode envelope_status
  // "EXECUTED" (i.e. "assume Foxit already reports this envelope fully
  // signed"). This is a manual/smoke-test shortcut, not a real signing
  // flow — Phase 3's foxit_client.py is the real integration; this UI
  // doesn't call it yet.
  const { warrant: current } = await getWarrant(warrantId);
  const result = await request<{ warrant: any }>("/warrants/transition", {
    method: "POST",
    body: JSON.stringify({
      warrant_id: warrantId,
      to_status: "active",
      envelope_status: "EXECUTED",
      returned_document_hash: current.document_hash,
      signer_email: signerEmail,
    }),
  });
  return { warrant: normalizeWarrant(result.warrant) };
}

export function getAuditLog(warrantId: string): Promise<{ entries: any[]; chain_intact: boolean; broken_at_index: number | null }> {
  const path = MODE === "mock" ? `/warrants/${warrantId}/audit` : `/audit-log?warrant_id=${warrantId}`;
  return request(path, { method: "GET" });
}

export function apiMode(): "mock" | "xano" {
  return MODE;
}
