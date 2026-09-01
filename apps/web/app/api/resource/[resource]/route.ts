/**
 * GET /api/resource/[resource] — the piece that was missing before this
 * commit: everywhere else in Tegata, "access" only ever meant a `status`
 * field changing color in the UI. Nothing actually checked that field
 * before handing anything over — you (Armand) could always just open
 * Xano's own dashboard and edit any row directly, which is real but is
 * Xano's own admin surface, not a stand-in for what an actual downstream
 * system gated by Tegata would do.
 *
 * This route is that downstream system, minimally: it stands in for
 * "the real internal wiki" (or whatever `resource` names). It does NOT
 * trust anything the browser claims about its own warrant state — it
 * takes the bearer token off the incoming request and asks Xano's own
 * GET /warrants for that token's warrants fresh, every single call, then
 * checks resource + status==="active" + not-yet-expired itself. A stolen
 * or forged client-side "granted" flag can't get past this because this
 * check never trusts the client's own copy of that state at all.
 *
 * This deliberately reuses GET /warrants rather than adding a new Xano
 * endpoint: that endpoint is already the one whose RBAC filtering was
 * verified against real Function Stack code (see PROJECT_STATUS.md,
 * "Verification of Xano AI's three Phase 7 responses") — a requester's
 * token only ever gets back their own rows, so this route doesn't need
 * to re-derive ownership, only re-check timing and resource name against
 * whatever Xano was willing to hand back for that specific token.
 */
import { NextRequest, NextResponse } from "next/server";

const XANO_BASE = process.env.NEXT_PUBLIC_XANO_API_BASE_URL || "";

// Standing in for whatever a real downstream system would actually be
// gating — a wiki page, a database console, a deploy button. Demo-only.
const PROTECTED_CONTENT: Record<string, string> = {
  internal_wiki:
    "🔒 CONFIDENTIAL — Internal Wiki\n\nQ3 infra migration runbook, on-call rotation schedule, and the staging DB credentials rotation checklist live here. You are only seeing this because Tegata found an active, unexpired warrant for this exact resource on your account, checked fresh against Xano just now — not because the page trusts anything your browser said about itself.",
};

export async function GET(req: NextRequest, { params }: { params: { resource: string } }) {
  const { resource } = params;
  const auth = req.headers.get("authorization");

  if (!auth) {
    return NextResponse.json(
      { granted: false, error: "missing_token", message: "No Authorization header — log in first." },
      { status: 401 },
    );
  }
  if (!XANO_BASE) {
    return NextResponse.json(
      { granted: false, error: "config_error", message: "NEXT_PUBLIC_XANO_API_BASE_URL is not set on the server." },
      { status: 500 },
    );
  }

  let warrantsRes: Response;
  try {
    warrantsRes = await fetch(`${XANO_BASE}/warrants`, {
      headers: { Authorization: auth },
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      { granted: false, error: "upstream_unreachable", message: String(err) },
      { status: 502 },
    );
  }

  if (warrantsRes.status === 401 || warrantsRes.status === 403) {
    return NextResponse.json(
      { granted: false, error: "invalid_session", message: "Xano rejected this token — log in again." },
      { status: warrantsRes.status },
    );
  }
  if (!warrantsRes.ok) {
    const text = await warrantsRes.text();
    return NextResponse.json(
      { granted: false, error: "upstream_error", message: `GET /warrants returned ${warrantsRes.status}: ${text.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const body = await warrantsRes.json();
  // Same "which shape did Xano actually use" question as
  // unwrapWarrantList() in apiClient.ts — reuse the same set of guesses
  // rather than inventing a fresh one here.
  const list: any[] = Array.isArray(body) ? body : body.warrants ?? body.items ?? body.result ?? [];

  const now = Date.now();
  const match = list.find((w) => {
    const wResource = w.resource ?? w.request?.resource;
    const expiresAtRaw = w.expires_at;
    const expiresAtMs = typeof expiresAtRaw === "number" ? expiresAtRaw : Date.parse(expiresAtRaw);
    return wResource === resource && w.status === "active" && Number.isFinite(expiresAtMs) && expiresAtMs > now;
  });

  if (!match) {
    return NextResponse.json(
      {
        granted: false,
        error: "forbidden",
        message: `No active, unexpired warrant for "${resource}" on this account. Request access, get it approved and signed, then come back.`,
      },
      { status: 403 },
    );
  }

  return NextResponse.json({
    granted: true,
    warrant_id: match.warrant_id ?? match.id,
    expires_at: match.expires_at,
    content: PROTECTED_CONTENT[resource] ?? `🔓 Access granted to "${resource}" (no demo payload configured for this resource name yet — add one to PROTECTED_CONTENT).`,
  });
}
