/**
 * POST /api/documents/prepare — the one step in Tegata's real-signing
 * pipeline that genuinely needs a server process rather than a no-code
 * step: Doctavian generates a document and hands back bytes, which then
 * have to be re-uploaded as a multipart file to Foxit. Xano's Function
 * Stack External API Request steps are built for JSON in/out, not this
 * kind of binary pass-through between two external APIs — so this one
 * step lives here (Node.js runtime), while warrant state and the actual
 * signature-status check stay in Xano (see docs/xano-setup.md §13 for
 * the corresponding Xano-side spec).
 *
 * Called from the Approver page once an approver has claimed a pending
 * request. Input is the warrant's own scoring output (already computed
 * by Xano/mock) plus the approver's identity (from the logged-in
 * session) — this route does NOT re-derive risk scores itself, it only
 * turns already-decided values into a signed document.
 *
 * Scope boundary (documented, not silently skipped): this only handles
 * the single-approver case (required_approver_count === 1). The
 * two-approver flow's real Foxit sequencing is not built yet — see
 * PROJECT_STATUS.md.
 *
 * Runs in the Node.js runtime (needs Buffer/crypto/fetch-with-FormData,
 * not available on the Edge runtime) — this is the App Router default,
 * stated explicitly here so it doesn't get silently switched later.
 */
export const runtime = "nodejs";

import { createHash } from "crypto";
import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { downloadDocument, generateDocument, loadDoctavianConfigFromEnv, uploadData, uploadTemplate } from "../../../../lib/doctavianClient";
import { createEnvelopeFromBinary, extractSigningUrl, loadFoxitConfigFromEnv } from "../../../../lib/foxitClient";
import { buildWarrantVariables } from "../../../../lib/warrantVariables";

interface PrepareRequestBody {
  warrant_id: string;
  resource: string;
  requested_by: string;
  reason: string;
  requested_duration_minutes: number;
  risk_score: number;
  risk_tier: string;
  factors: { resource_sensitivity: number; duration_factor: number; time_of_day_factor: number; requester_history_factor: number };
  approval_requirement: { required_approver_count: number; max_duration_minutes: number };
  approver: { name: string; email: string };
}

function splitName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed || "Approver", lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

export async function POST(req: NextRequest) {
  let body: PrepareRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.warrant_id || !body.approver?.email) {
    return NextResponse.json({ error: "validation_failed", message: "warrant_id and approver.email are required" }, { status: 400 });
  }
  if (body.approval_requirement.required_approver_count !== 1) {
    return NextResponse.json(
      {
        error: "unsupported_approver_count",
        message: "Real Doctavian+Foxit signing is only wired up for required_approver_count === 1 so far — see PROJECT_STATUS.md.",
      },
      { status: 501 }
    );
  }

  let doctavianConfig, foxitConfig;
  try {
    doctavianConfig = loadDoctavianConfigFromEnv();
    foxitConfig = loadFoxitConfigFromEnv();
  } catch (err: any) {
    return NextResponse.json({ error: "config_error", message: err.message }, { status: 500 });
  }

  try {
    // Step 1: Doctavian — generate the warrant document from the
    // already-decided scoring output.
    const templateBuffer = await readFile(path.join(process.cwd(), "assets", "tegata-warrant.docx"));
    const uploadedTemplate = await uploadTemplate(doctavianConfig, templateBuffer, "tegata-warrant.docx");

    const variables = buildWarrantVariables({
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
    const dataFields = Object.fromEntries(variables.map((v) => [v.name, v.value]));
    const uploadedData = await uploadData(doctavianConfig, { data: dataFields });

    const externalRequestId = `${body.warrant_id}-${Date.now()}`;
    const generated = await generateDocument(doctavianConfig, {
      templateName: "Tegata Warrant",
      templateUrn: uploadedTemplate.id,
      documentName: `warrant-${body.warrant_id}`,
      variables,
      externalRequestId,
      dataUrn: uploadedData.id,
      documentFileFormat: "pdf",
    });
    const documentId = generated.urn;
    const pdfBytes = await downloadDocument(doctavianConfig, documentId);
    const documentHash = createHash("sha256").update(pdfBytes).digest("hex");

    // Step 2: Foxit — create the signing envelope from the real PDF
    // bytes, with an embedded signing session for the approver so the
    // demo doesn't have to wait on an email round-trip.
    const { firstName, lastName } = splitName(body.approver.name || body.approver.email);
    const envelope = await createEnvelopeFromBinary(foxitConfig, {
      pdfBuffer: pdfBytes,
      pdfFileName: `warrant-${body.warrant_id}.pdf`,
      folderName: `Tegata Warrant ${body.warrant_id}`,
      parties: [{ firstName, lastName, email: body.approver.email, sequence: 1 }],
      fields: [
        // x/y are a best guess (bottom-of-page-1 signature block) —
        // Foxit's coordinate origin/units for this endpoint haven't
        // been confirmed against a real generated envelope yet. Open
        // the first real test envelope and adjust before trusting the
        // signature box position in a demo recording.
        { type: "signature", x: 100, y: 650, width: 200, height: 50, pageNumber: 1, party: 1, required: true },
      ],
      sendNow: true,
      createEmbeddedSigningSession: true,
    });
    const folderId =
      envelope.folderId ??
      envelope.folder_id ??
      envelope.result?.folderId ??
      envelope.result?.folder_id ??
      envelope.data?.folderId ??
      envelope.data?.folder_id ??
      envelope.id ??
      null;
    if (folderId === null || folderId === undefined) {
      // Fail HERE, loudly, with the raw response — instead of silently
      // sending folder_id: null downstream to Xano's attach-envelope,
      // which surfaces as a confusing generic "Missing param: folder_id"
      // that looks like a Xano problem when it's really this extraction
      // guessing wrong about Foxit's actual response shape.
      return NextResponse.json(
        {
          error: "folder_id_extraction_failed",
          message: `Foxit's createfolder call succeeded, but none of the guessed key names (folderId, folder_id, result.folderId, result.folder_id, data.folderId, data.folder_id, id) matched anything in the response. See raw_envelope below for the actual shape — find the real key and add it to prepare/route.ts's folderId extraction.`,
          raw_envelope: envelope,
        },
        { status: 502 }
      );
    }
    const signingUrl = extractSigningUrl(envelope);

    return NextResponse.json({
      warrant_id: body.warrant_id,
      document_id: documentId,
      document_hash: documentHash,
      folder_id: folderId,
      signing_url: signingUrl,
      raw_envelope: envelope, // included so the caller/demo can inspect the real shape until extractSigningUrl is confirmed
    });
  } catch (err: any) {
    return NextResponse.json({ error: "prepare_failed", message: err.message ?? String(err), raw: err.raw }, { status: 502 });
  }
}
