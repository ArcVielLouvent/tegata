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
 *
 * REAL SIGNING PIPELINE (added 2026-08-29, required_approver_count === 1
 * only so far): prepareSignature() -> confirmSignature(), see their own
 * docs below. signWarrant() above is now the LEGACY fallback for
 * everything that path doesn't cover yet (2-approver case). This is a
 * deliberate hybrid: the Doctavian-generate -> Foxit-envelope binary
 * pass-through runs in this app's own /api/documents/prepare (Node.js
 * runtime handles binary data trivially; Xano's Function Stack External
 * API Request steps are built for JSON), while Xano remains the source
 * of truth for warrant state and is the one that verifies the real
 * Foxit envelope status server-to-server (see docs/xano-setup.md §13)
 * — not something this client is trusted to self-report.
 */
import type { AccessRequest } from "@tegata/schema";
import type { MockWarrant } from "./mockStore";

const MODE = (process.env.NEXT_PUBLIC_API_MODE || "mock") as "mock" | "xano";
const XANO_BASE = process.env.NEXT_PUBLIC_XANO_API_BASE_URL || "";

// Set by AuthContext once a user logs in. Module-level rather than passed
// as a parameter to every call, since every page already goes through
// this one client and shouldn't need to thread a token through on every
// call site. Irrelevant in mock mode — the /api/mock/* routes have no
// auth of their own.
let authToken: string | null = null;
export function setAuthToken(token: string | null): void {
  authToken = token;
}

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
  const url = `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(MODE === "xano" && authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
  } catch (err) {
    // fetch() throws a bare TypeError (not an HTTP error — no response
    // was ever received) for: a malformed base URL, DNS/connection
    // failure, or a CORS rejection. All three look identical to the
    // browser, so this can't pinpoint which one — but "TypeError:
    // Failed to fetch" with no other context (what we used to just
    // let propagate) is useless to debug from. Surface the actual URL
    // that was attempted so the message is at least actionable: check
    // that URL for typos/missing scheme first, then Xano's workspace
    // CORS settings if the URL looks right.
    throw new ApiError(0, {
      error: "network_error",
      message: `Could not reach ${url} — no response was received at all (not a 4xx/5xx from Xano). Most likely causes: NEXT_PUBLIC_XANO_API_BASE_URL is wrong/malformed (check apps/web/.env.local — did the dev server get restarted after setting it? NEXT_PUBLIC_ vars are baked in at server start, not hot-reloaded), or Xano's workspace CORS settings don't allow this origin. Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}

/** Best-effort adapter for a real Xano warrant record into the shape this
 * UI already renders (MockWarrant-ish). Every read is defensive with a
 * fallback, because the exact Xano response shape hasn't been confirmed
 * field-by-field yet — see the module docstring. No-op in mock mode.
 * Throws a diagnostic ApiError (not a cryptic TypeError) if `raw` itself
 * is missing — see unwrapWarrant() below, which is what actually finds
 * `raw` in the first place. */
/** Confirmed VERBATIM response shape for a single warrant from real
 * Xano (2026-08-29, via Xano's own dev pasting the actual JSON — not a
 * guess this time):
 *   { id, warrant_id, request_id, risk_score (a plain number, NOT
 *     nested), risk_tier, factor_resource_sensitivity, factor_duration,
 *     factor_time_of_day, factor_requester_history,
 *     required_approver_count, max_duration_minutes, status, used,
 *     document_url, document_hash, approver_email,
 *     created_at (epoch milliseconds, NOT an ISO string),
 *     expires_at (epoch milliseconds or null) }
 *
 * CONFIRMED GAP, not a frontend bug: resource/reason/requested_by are
 * NOT in this response at all — they live in the `requests` table and
 * Xano's GET /warrants doesn't join/eval them in. Until that's added
 * Xano-side, these three fields are unavoidably blank here — the
 * fallback below to "" is correct given what the API actually returns,
 * not a mapping bug to fix on this side. */
function normalizeWarrant(raw: any): MockWarrant {
  if (MODE === "mock") return raw as MockWarrant;
  if (!raw || typeof raw !== "object") {
    throw new ApiError(0, {
      error: "unexpected_response_shape",
      message: `Expected a warrant object but got ${JSON.stringify(raw)}. This means unwrapWarrant() in apiClient.ts couldn't find one in Xano's response — see the console for the full raw response and fix unwrapWarrant()'s key list to match.`,
    });
  }

  const score = typeof raw.risk_score === "number" ? raw.risk_score : (raw.risk_score?.score ?? 0);
  const tier = raw.risk_tier ?? raw.risk_score?.tier ?? "low";
  const requiredApprovers = raw.required_approver_count ?? 1;
  const maxDuration = raw.max_duration_minutes ?? raw.requested_duration_minutes ?? 0;

  // Epoch milliseconds -> ISO string, since MockWarrant's type (and
  // everything that renders it) expects a string, not a raw number.
  const toIsoOrNull = (v: unknown): string | null => {
    if (v === null || v === undefined) return null;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  };

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
      factors: {
        resource_sensitivity: raw.factor_resource_sensitivity ?? 0,
        duration_factor: raw.factor_duration ?? 0,
        time_of_day_factor: raw.factor_time_of_day ?? 0,
        requester_history_factor: raw.factor_requester_history ?? 0,
      },
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
    signatures: raw.status === "active" ? [{ email: raw.approver_email ?? "unknown", signed_at: toIsoOrNull(raw.created_at) ?? new Date().toISOString() }] : [],
    activated_at: null, // Xano's GET /warrants response has no such field — not used for anything rendered in xano mode, unlike mock mode where it drives computeExpiresAt() locally
    expires_at: toIsoOrNull(raw.expires_at),
    created_at: toIsoOrNull(raw.created_at) ?? new Date().toISOString(),
  } as MockWarrant;
}

/** Tries several plausible shapes for "the warrant object" in a Xano
 * response, since the exact wrapping (`{warrant: ...}` vs `{data: ...}`
 * vs the object directly at the top level) was never confirmed against
 * a real response body — confirmed 2026-08-29 that assuming `{warrant:
 * ...}` unconditionally crashes with "Cannot read properties of
 * undefined" when it's wrong. Returns undefined (not a throw) if
 * nothing plausible is found, so callers can build a proper diagnostic
 * ApiError with the full raw response attached — see normalizeWarrant(). */
function unwrapWarrant(result: any): any {
  if (!result || typeof result !== "object") return undefined;
  if (result.warrant && typeof result.warrant === "object") return result.warrant;
  if (result.data && typeof result.data === "object" && !Array.isArray(result.data)) return result.data;
  // If the result itself already looks like a warrant (has an id-ish or
  // status field), it's probably not wrapped at all.
  if ("warrant_id" in result || "id" in result || "status" in result) return result;
  return undefined;
}

/** Same idea as unwrapWarrant() but for the LIST endpoint — tries
 * `{warrants: [...]}`, `{data: [...]}`, `{items: [...]}`, or the
 * response being a bare array already. Returns undefined (not []) when
 * nothing plausible matches — a genuinely empty list IS one of the
 * matched shapes (e.g. bare `[]`, `{warrants: []}`), so this can tell
 * "no warrants yet" apart from "wrong shape entirely", unlike the
 * previous version which silently returned [] for both. Confirmed
 * 2026-08-29: that silent-[] fallback is why a warrant that really did
 * get created in Xano never showed up on the Approver page for either
 * account — no error, no warrant, nothing to go on. */
function unwrapWarrantList(result: any): any[] | undefined {
  if (Array.isArray(result)) return result;
  if (!result || typeof result !== "object") return undefined;
  if (Array.isArray(result.warrants)) return result.warrants;
  if (Array.isArray(result.data)) return result.data;
  if (Array.isArray(result.items)) return result.items;
  return undefined;
}

export async function listWarrants(): Promise<{ warrants: MockWarrant[] }> {
  const result = await request<any>("/warrants", { method: "GET" });
  if (MODE === "mock") return { warrants: (result.warrants || []).map(normalizeWarrant) };
  const list = unwrapWarrantList(result);
  if (list === undefined) {
    throw new ApiError(0, {
      error: "unrecognized_response_shape",
      message: `GET /warrants returned a shape unwrapWarrantList() doesn't recognize: ${JSON.stringify(result)}. Fix unwrapWarrantList()'s key list in apiClient.ts to match, once you know the real key name.`,
    });
  }
  return { warrants: list.map(normalizeWarrant) };
}

export async function getWarrant(warrantId: string): Promise<{ warrant: MockWarrant }> {
  if (MODE === "mock") {
    const result = await request<{ warrant: any }>(`/warrants/${warrantId}`, { method: "GET" });
    return { warrant: normalizeWarrant(result.warrant) };
  }
  // Xano only ever confirmed a LIST endpoint (GET /warrants) — a
  // single-record GET /warrants/{warrant_id} by path param was never
  // actually verified to exist and likely doesn't (docs/xano-setup.md
  // never mentions one). This used to assume it did, which would 404
  // for both signWarrant()'s legacy path and the audit trail page.
  // Fetch the list (already confirmed working) and filter client-side.
  const { warrants } = await listWarrants();
  const warrant = warrants.find((w) => w.warrant_id === warrantId);
  if (!warrant) {
    throw new ApiError(404, { error: "not_found", message: `No warrant with id ${warrantId}` });
  }
  return { warrant };
}

export async function createWarrant(accessRequest: AccessRequest): Promise<{ warrant: MockWarrant }> {
  // Real Xano target: POST /score — confirmed 2026-08-28 to already
  // persist the warrant itself (contrary to this file's earlier
  // assumption of a separate POST /warrants endpoint).
  const path = MODE === "mock" ? "/warrants" : "/score";
  // ticket_ref is optional in our own schema (AccessRequestSchema), but
  // Xano's live /score input declares it required (confirmed 2026-08-28:
  // an omitted ticket_ref fails with "Missing param: ticket_ref"). Since
  // it's optional, JSON.stringify() silently drops it when undefined —
  // so send it explicitly as "" rather than omitting the key. Harmless
  // in mock mode, where the mock /warrants route already treats it as
  // optional and ignores an empty string the same way it ignores a
  // missing key.
  const body = { ...accessRequest, ticket_ref: accessRequest.ticket_ref ?? "" };
  const result = await request<any>(path, { method: "POST", body: JSON.stringify(body) });
  const raw = MODE === "mock" ? result.warrant : unwrapWarrant(result);
  return { warrant: normalizeWarrant(raw) };
}

export async function signWarrant(warrantId: string, signerEmail: string): Promise<{ warrant: MockWarrant }> {
  if (MODE === "mock") {
    const result = await request<{ warrant: any }>(`/warrants/${warrantId}/sign`, {
      method: "POST",
      body: JSON.stringify({ signer_email: signerEmail, warrant_id: warrantId }),
    });
    return { warrant: normalizeWarrant(result.warrant) };
  }

  // Real Xano, LEGACY PATH: POST /warrants/transition with a
  // client-supplied envelope_status. Kept only as a fallback for
  // warrants that were never run through prepareSignature() (e.g.
  // required_approver_count === 2, not wired to real Foxit yet — see
  // prepareSignature's module docs). Prefer confirmSignature() below
  // for any warrant that has a real folder_id from prepareSignature().
  const { warrant: current } = await getWarrant(warrantId);
  const result = await request<any>("/warrants/transition", {
    method: "POST",
    body: JSON.stringify({
      warrant_id: warrantId,
      to_status: "active",
      envelope_status: "EXECUTED",
      returned_document_hash: current.document_hash,
      signer_email: signerEmail,
    }),
  });
  return { warrant: normalizeWarrant(unwrapWarrant(result)) };
}

/** Step 1 of the real-signing pipeline: generate the warrant document
 * (Doctavian) and create a Foxit signing envelope from it, via this
 * app's own /api/documents/prepare route (the binary-pass-through step
 * — see that route's module docs for why it isn't a Xano Function
 * Stack step). Only meaningful in xano mode; not called in mock mode.
 * Only supports required_approver_count === 1 so far. */
export async function prepareSignature(warrant: MockWarrant, approver: { name: string; email: string }): Promise<{ document_id: string; document_hash: string; folder_id: string | number | null; signing_url: string | null }> {
  const res = await fetch("/api/documents/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      warrant_id: warrant.warrant_id,
      resource: warrant.request.resource,
      requested_by: warrant.request.requested_by,
      reason: warrant.request.reason,
      requested_duration_minutes: warrant.request.requested_duration_minutes,
      risk_score: warrant.risk_score.score,
      risk_tier: warrant.risk_score.tier,
      factors: warrant.risk_score.factors,
      approval_requirement: warrant.approval_requirement,
      approver,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

/** Immediately follows prepareSignature(): tells Xano about the real
 * envelope so confirmSignature() has something to verify against (see
 * docs/xano-setup.md §13b). Requires that Xano-side endpoint to exist;
 * until it's built this returns the same 404 pattern §9a/§9b did
 * before they existed. */
export async function attachEnvelope(
  warrantId: string,
  envelope: { document_id: string; document_hash: string; folder_id: string | number | null; signing_url: string | null }
): Promise<{ warrant: MockWarrant }> {
  const result = await request<any>("/warrants/attach-envelope", {
    method: "POST",
    body: JSON.stringify({
      warrant_id: warrantId,
      document_id: envelope.document_id,
      document_hash: envelope.document_hash,
      folder_id: envelope.folder_id,
      signing_url: envelope.signing_url,
    }),
  });
  return { warrant: normalizeWarrant(unwrapWarrant(result)) };
}

/** Step 2, once the approver has actually signed at the Foxit signing_url
 * from prepareSignature(): asks Xano to verify the REAL envelope status
 * with Foxit itself (server-to-server, via the folder_id attached in
 * step 1) rather than trusting whatever this client claims — see
 * docs/xano-setup.md §13. Requires that Xano-side endpoint to exist;
 * until it's built this returns the same 404 pattern §9a/§9b did before
 * they existed. */
export async function confirmSignature(warrantId: string, folderId: string | number): Promise<{ warrant: MockWarrant }> {
  const result = await request<any>("/warrants/confirm-signature", {
    method: "POST",
    body: JSON.stringify({ warrant_id: warrantId, folder_id: folderId }),
  });
  return { warrant: normalizeWarrant(unwrapWarrant(result)) };
}

export function getAuditLog(warrantId: string): Promise<{ entries: any[]; chain_intact: boolean; broken_at_index: number | null }> {
  const path = MODE === "mock" ? `/warrants/${warrantId}/audit` : `/audit-log?warrant_id=${warrantId}`;
  return request(path, { method: "GET" });
}

export function apiMode(): "mock" | "xano" {
  return MODE;
}
