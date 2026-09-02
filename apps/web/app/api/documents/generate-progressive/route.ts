/**
 * POST /api/documents/generate-progressive — Stretch A (ROADMAP.md
 * Phase 7 #4), see progressiveDisclosureDocument.ts's module docs for
 * the pivot from Foxit Smart Redact to Doctavian conditional
 * templating, and the real limitation (not auto-wired to a real
 * first-signature event yet).
 *
 * Input: same warrant fields as /api/documents/generate-dual, plus
 * reveal_level: "redacted" | "full". Kept as its own route for the
 * same isolation reason as verify-consistency/generate-dual — new,
 * only-partially-verified code layered on top of Phase 6's
 * still-being-debugged signing pipeline.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { loadDoctavianConfigFromEnv } from "../../../../lib/doctavianClient";
import { generateProgressiveDisclosureDocument, RevealLevel } from "../../../../lib/progressiveDisclosureDocument";

interface GenerateProgressiveBody {
  warrant_id: string;
  resource: string;
  requested_by: string;
  reason: string;
  requested_duration_minutes: number;
  risk_score: number;
  risk_tier: string;
  factors: { resource_sensitivity: number; duration_factor: number; time_of_day_factor: number; requester_history_factor: number };
  approval_requirement: { required_approver_count: number; max_duration_minutes: number };
  reveal_level: RevealLevel;
}

export async function POST(req: NextRequest) {
  let body: GenerateProgressiveBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.warrant_id || !body.resource || (body.reveal_level !== "redacted" && body.reveal_level !== "full")) {
    return NextResponse.json({ error: "validation_failed", message: "warrant_id, resource, and reveal_level ('redacted' | 'full') are required" }, { status: 400 });
  }

  let doctavianConfig;
  try {
    doctavianConfig = loadDoctavianConfigFromEnv();
  } catch (err: any) {
    return NextResponse.json({ error: "config_error", message: err.message }, { status: 500 });
  }

  try {
    const result = await generateProgressiveDisclosureDocument(
      doctavianConfig,
      {
        warrantId: body.warrant_id,
        resource: body.resource,
        requested_by: body.requested_by,
        reason: body.reason,
        requested_duration_minutes: body.requested_duration_minutes,
        risk_score: body.risk_score,
        risk_tier: body.risk_tier,
        factors: body.factors,
        max_duration_minutes: body.approval_requirement.max_duration_minutes,
        required_approver_count: body.approval_requirement.required_approver_count,
      },
      body.reveal_level
    );
    return NextResponse.json({
      document_id: result.documentId,
      pdf_base64: result.pdf.toString("base64"),
      document_hash: result.documentHash,
      reveal_level: result.revealLevel,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "generation_failed", message: err.message ?? String(err), raw: err.raw }, { status: 502 });
  }
}
