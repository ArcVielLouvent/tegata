/**
 * Single point where the UI decides whether it's talking to the local
 * mock backend or a real Xano workspace. Pages never call fetch() directly
 * against either target — everything goes through here, so flipping
 * NEXT_PUBLIC_API_MODE is the only thing that has to change.
 *
 * XANO MODE NOTE (as of 2026-08-28): the endpoint paths below for
 * create/sign are what docs/xano-setup.md §9a/§9b *specify* — they don't
 * exist in the live Xano workspace yet (see PROJECT_STATUS.md). Score,
 * approval, list-warrants, and audit-log reads already exist per
 * PROJECT_STATUS.md's "Xano setup, first pass" section.
 */
import type { AccessRequest } from "@tegata/schema";
import type { MockWarrant } from "./mockStore";

const MODE = (process.env.NEXT_PUBLIC_API_MODE || "mock") as "mock" | "xano";
const XANO_BASE = process.env.NEXT_PUBLIC_XANO_API_BASE_URL || "";

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: any
  ) {
    super(body?.message || body?.error || `Request failed with status ${status}`);
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

export function listWarrants(): Promise<{ warrants: MockWarrant[] }> {
  return request(MODE === "mock" ? "/warrants" : "/warrants", { method: "GET" });
}

export function getWarrant(warrantId: string): Promise<{ warrant: MockWarrant }> {
  return request(`/warrants/${warrantId}`, { method: "GET" });
}

export function createWarrant(accessRequest: AccessRequest): Promise<{ warrant: MockWarrant }> {
  // Real Xano target: POST /warrants (docs/xano-setup.md §9b).
  return request("/warrants", { method: "POST", body: JSON.stringify(accessRequest) });
}

export function signWarrant(warrantId: string, signerEmail: string): Promise<{ warrant: MockWarrant }> {
  // Real Xano target: POST /verify-signature (docs/xano-setup.md §9a) —
  // in mock mode this single call also stands in for "Foxit sends the
  // signed envelope back," which in the real system is a separate step.
  const path = MODE === "mock" ? `/warrants/${warrantId}/sign` : "/verify-signature";
  return request(path, { method: "POST", body: JSON.stringify({ signer_email: signerEmail, warrant_id: warrantId }) });
}

export function getAuditLog(warrantId: string): Promise<{ entries: any[]; chain_intact: boolean; broken_at_index: number | null }> {
  const path = MODE === "mock" ? `/warrants/${warrantId}/audit` : `/audit-log?warrant_id=${warrantId}`;
  return request(path, { method: "GET" });
}

export function apiMode(): "mock" | "xano" {
  return MODE;
}
