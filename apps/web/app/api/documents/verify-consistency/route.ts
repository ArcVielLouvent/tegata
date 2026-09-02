/**
 * POST /api/documents/verify-consistency — Stretch B (ROADMAP.md Phase
 * 7 #2), see ocrConsistencyCheck.ts's own module docs for what this
 * checks and why.
 *
 * Deliberately kept as its OWN route, not wired into
 * /api/documents/prepare's existing pipeline: Phase 6's signing
 * pipeline is still being debugged live (see PROJECT_STATUS.md) and
 * this is new, unverified-end-to-end code (this sandbox cannot reach
 * na1.fusion.foxit.com to test it) — bolting it into the
 * already-fragile working path risks breaking something that's
 * currently making real progress, for a stretch feature that isn't
 * required. Call this separately, after prepareSignature() has
 * already produced a document, once Phase 6's own bugs are resolved.
 *
 * Input: { pdf_base64: string, file_name?: string, expected_facts:
 * Record<string,string> }. expected_facts should be the same
 * key/value pairs passed to Doctavian's buildWarrantVariables() (or a
 * subset) — the route does not re-derive facts from a warrant_id
 * lookup, on purpose (see ocrConsistencyCheck.ts).
 *
 * Runs in Node.js — needs Buffer, and the extraction round-trip can
 * take up to ~60s (real async job on Foxit's side, see
 * foxitPdfServicesClient.ts's pollUntilDone), well past Vercel's
 * default serverless function timeout on some plans. Flagged here,
 * not solved — a real deployment may need this on a longer-timeout
 * plan/runtime, or converted to a background job, before this is
 * demo-safe under real time pressure.
 */
export const runtime = "nodejs";
export const maxDuration = 90; // seconds — see module docs above; has no effect on platforms that don't read this Next.js convention

import { NextRequest, NextResponse } from "next/server";
import { loadFoxitPdfServicesConfigFromEnv } from "../../../../lib/foxitPdfServicesClient";
import { runOcrConsistencyCheck } from "../../../../lib/ocrConsistencyCheck";

export async function POST(req: NextRequest) {
  let body: { pdf_base64?: string; file_name?: string; expected_facts?: Record<string, string> };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.pdf_base64 || !body.expected_facts || Object.keys(body.expected_facts).length === 0) {
    return NextResponse.json({ error: "validation_failed", message: "pdf_base64 and a non-empty expected_facts object are required" }, { status: 400 });
  }

  let config;
  try {
    config = loadFoxitPdfServicesConfigFromEnv();
  } catch (err: any) {
    return NextResponse.json({ error: "config_error", message: err.message }, { status: 500 });
  }

  let pdfBuffer: Buffer;
  try {
    pdfBuffer = Buffer.from(body.pdf_base64, "base64");
  } catch {
    return NextResponse.json({ error: "validation_failed", message: "pdf_base64 is not valid base64" }, { status: 400 });
  }

  try {
    const result = await runOcrConsistencyCheck(config, pdfBuffer, body.file_name || "document.pdf", body.expected_facts);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: "consistency_check_failed", message: err.message ?? String(err), raw: err.raw }, { status: 502 });
  }
}
