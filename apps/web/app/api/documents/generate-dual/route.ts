/**
 * POST /api/documents/generate-dual — Stretch E (ROADMAP.md Phase 7
 * #3), see dualAudienceDocuments.ts's own module docs.
 *
 * Kept as its own route for the same reason as
 * /api/documents/verify-consistency: this is new, unverified-end-to-end
 * code (this sandbox has no network access to Doctavian) layered on
 * top of Phase 6's already-fragile-but-progressing signing pipeline —
 * isolating it means it can't accidentally break /api/documents/prepare
 * while Phase 6's own bugs are still being worked through.
 *
 * Input: same shape /api/documents/prepare accepts for a warrant, plus
 * warrant_id explicitly (the runbook template's grant command needs
 * it; prepare's route derives it from the URL/body already, this one
 * needs it passed in since it has no warrant lookup of its own).
 * Output: both documents' base64 PDF bytes + hashes — NOT sent to
 * Foxit for signing (that's Phase 6's existing prepareSignature(),
 * unchanged; this route only generates, same "AI proposes" boundary
 * as elsewhere in this project).
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { loadDoctavianConfigFromEnv } from "../../../../lib/doctavianClient";
import { generateDualAudienceDocuments } from "../../../../lib/dualAudienceDocuments";

interface GenerateDualBody {
  warrant_id: string;
  resource: string;
  requested_by: string;
  reason: string;
  requested_duration_minutes: number;
  risk_score: number;
  risk_tier: string;
  factors: { resource_sensitivity: number; duration_factor: number; time_of_day_factor: number; requester_history_factor: number };
  approval_requirement: { required_approver_count: number; max_duration_minutes: number };
}

export async function POST(req: NextRequest) {
  let body: GenerateDualBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.warrant_id || !body.resource) {
    return NextResponse.json({ error: "validation_failed", message: "warrant_id and resource are required" }, { status: 400 });
  }

  let doctavianConfig;
  try {
    doctavianConfig = loadDoctavianConfigFromEnv();
  } catch (err: any) {
    return NextResponse.json({ error: "config_error", message: err.message }, { status: 500 });
  }

  try {
    const result = await generateDualAudienceDocuments(doctavianConfig, {
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
    });
    return NextResponse.json({
      warrant_document_id: result.warrantDocumentId,
      warrant_pdf_base64: result.warrantPdf.toString("base64"),
      warrant_document_hash: result.warrantDocumentHash,
      runbook_document_id: result.runbookDocumentId,
      runbook_pdf_base64: result.runbookPdf.toString("base64"),
      runbook_document_hash: result.runbookDocumentHash,
    });
  } catch (err: any) {
    return NextResponse.json({ error: "generation_failed", message: err.message ?? String(err), raw: err.raw }, { status: 502 });
  }
}
