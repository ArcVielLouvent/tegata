/**
 * Stretch E (ROADMAP.md Phase 7 #3 / docs/tegata-concept.md's "Stretch
 * E"): "from a single API call/data payload, Doctavian produces TWO
 * different documents for two audiences" — the existing formal warrant
 * (approver-facing) plus an internal runbook (on-call-engineer-facing,
 * technical/execution framing, copy-paste-ready, with expiry
 * reminders).
 *
 * Deliberately thin: this reuses generateDocument()/uploadTemplate()/
 * uploadData()/downloadDocument() from doctavianClient.ts completely
 * unchanged (that pipeline is already confirmed working end-to-end in
 * Phase 6's signing flow — see /api/documents/prepare) — the only new
 * thing here is a SECOND template
 * (apps/web/assets/tegata-runbook.docx, confirmed-syntax merge fields
 * {!name} and <mdoc:paragraph> conditionals matching
 * tegata-warrant.docx's own already-working syntax exactly, built by
 * cloning that template's OOXML package and swapping only its
 * word/document.xml — not hand-rolled from scratch) and one extra
 * template variable (warrant_id) that the warrant template doesn't
 * need but the runbook does (the grant command needs something to
 * reference).
 */
import { readFile } from "fs/promises";
import path from "path";
import { downloadDocument, generateDocument, uploadData, uploadTemplate, DoctavianConfig, TemplateVariable } from "./doctavianClient";
import { buildWarrantVariables } from "./warrantVariables";

export interface DualAudienceInput {
  warrantId: string;
  resource: string;
  requested_by: string;
  reason: string;
  requested_duration_minutes: number;
  risk_score: number;
  risk_tier: string;
  factors: { resource_sensitivity: number; duration_factor: number; time_of_day_factor: number; requester_history_factor: number };
  max_duration_minutes: number;
  required_approver_count: number;
}

export interface DualAudienceResult {
  warrantDocumentId: string;
  warrantPdf: Buffer;
  warrantDocumentHash: string;
  runbookDocumentId: string;
  runbookPdf: Buffer;
  runbookDocumentHash: string;
}

async function generateOne(config: DoctavianConfig, templateFileName: string, templateDisplayName: string, documentName: string, variables: TemplateVariable[], externalRequestId: string): Promise<{ documentId: string; pdf: Buffer }> {
  const templateBuffer = await readFile(path.join(process.cwd(), "assets", templateFileName));
  const uploadedTemplate = await uploadTemplate(config, templateBuffer, templateFileName);
  const dataFields = Object.fromEntries(variables.map((v) => [v.name, v.value]));
  const uploadedData = await uploadData(config, { data: dataFields });
  const generated = await generateDocument(config, {
    templateName: templateDisplayName,
    templateUrn: uploadedTemplate.id,
    documentName,
    variables,
    externalRequestId,
    dataUrn: uploadedData.id,
    documentFileFormat: "pdf",
  });
  const documentId = generated.urn;
  const pdf = await downloadDocument(config, documentId);
  return { documentId, pdf };
}

/** Generates BOTH documents from the same input. Runs sequentially
 * (not Promise.all) deliberately: this reuses Doctavian's real API,
 * which this project has already had rate-limit/quota surprises with
 * elsewhere (see llmClient.ts's OpenRouter notes) — two concurrent
 * generate calls against the same account is an unforced risk for a
 * stretch feature, when sequential costs a few extra seconds at most. */
export async function generateDualAudienceDocuments(config: DoctavianConfig, input: DualAudienceInput): Promise<DualAudienceResult> {
  const sharedVariables = buildWarrantVariables({
    resource: input.resource,
    requested_by: input.requested_by,
    reason: input.reason,
    requested_duration_minutes: input.requested_duration_minutes,
    risk_score: input.risk_score,
    risk_tier: input.risk_tier,
    factors: input.factors,
    max_duration_minutes: input.max_duration_minutes,
    required_approver_count: input.required_approver_count,
  });
  const runbookVariables: TemplateVariable[] = [...sharedVariables, { name: "warrant_id", value: input.warrantId }];

  const baseRequestId = `${input.warrantId}-${Date.now()}`;
  const warrant = await generateOne(config, "tegata-warrant.docx", "Tegata Warrant", `warrant-${input.warrantId}`, sharedVariables, `${baseRequestId}-warrant`);
  const runbook = await generateOne(config, "tegata-runbook.docx", "Tegata Runbook", `runbook-${input.warrantId}`, runbookVariables, `${baseRequestId}-runbook`);

  const { createHash } = await import("crypto");
  return {
    warrantDocumentId: warrant.documentId,
    warrantPdf: warrant.pdf,
    warrantDocumentHash: createHash("sha256").update(warrant.pdf).digest("hex"),
    runbookDocumentId: runbook.documentId,
    runbookPdf: runbook.pdf,
    runbookDocumentHash: createHash("sha256").update(runbook.pdf).digest("hex"),
  };
}
