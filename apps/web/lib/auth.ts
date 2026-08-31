/**
 * Client for Xano's "Authentication" API group (Public, 7 endpoints —
 * separate base URL from "Tegata Core"). Confirmed manually by Armand via
 * Xano's Run & Debug panel: register (name/email/password) -> login
 * (email/password) -> authToken; new users default to role="requester"
 * in the database (approver role is assigned manually in the Xano
 * dashboard, no self-service endpoint for it).
 *
 * ASSUMPTION, NOT YET CONFIRMED FROM SWAGGER: the exact endpoint paths
 * below (/auth/signup, /auth/login, /auth/me) are Xano's standard
 * starter-kit naming. If your workspace uses different paths, override
 * them via the three NEXT_PUBLIC_XANO_AUTH_*_PATH env vars below rather
 * than editing this file — see apps/web/.env.local.example.
 */

const AUTH_BASE = process.env.NEXT_PUBLIC_XANO_AUTH_BASE_URL || "";
const SIGNUP_PATH = process.env.NEXT_PUBLIC_XANO_AUTH_SIGNUP_PATH || "/auth/signup";
const LOGIN_PATH = process.env.NEXT_PUBLIC_XANO_AUTH_LOGIN_PATH || "/auth/login";
const ME_PATH = process.env.NEXT_PUBLIC_XANO_AUTH_ME_PATH || "/auth/me";

const TOKEN_STORAGE_KEY = "tegata_auth_token";

export interface AuthUser {
  id?: string | number;
  name?: string;
  email: string;
  role?: string;
}

export class AuthError extends Error {
  constructor(
    public status: number,
    body: any
  ) {
    super(typeof body?.message === "string" ? body.message : body?.error || `Auth request failed (${status})`);
  }
}

async function authRequest<T>(path: string, body: unknown): Promise<T> {
  if (!AUTH_BASE) {
    throw new AuthError(0, { error: "NEXT_PUBLIC_XANO_AUTH_BASE_URL is not set — see apps/web/.env.local.example" });
  }
  const res = await fetch(`${AUTH_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(res.status, json);
  return json as T;
}

export async function register(name: string, email: string, password: string): Promise<{ authToken: string }> {
  return authRequest(SIGNUP_PATH, { name, email, password });
}

export async function login(email: string, password: string): Promise<{ authToken: string }> {
  return authRequest(LOGIN_PATH, { email, password });
}

export async function fetchMe(token: string): Promise<AuthUser> {
  if (!AUTH_BASE) throw new AuthError(0, { error: "NEXT_PUBLIC_XANO_AUTH_BASE_URL is not set" });
  const res = await fetch(`${AUTH_BASE}${ME_PATH}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(res.status, json);
  return json as AuthUser;
}

// --- Token persistence (browser only — this is a real delivered app, not
// an Artifact, so localStorage is fine here; it is NOT fine inside
// artifact-preview code, which has a separate, stricter rule). ---

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function storeToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
}
