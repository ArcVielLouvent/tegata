/**
 * Stretch A (ROADMAP.md Phase 7 #4): "for a 2-approver (high-risk)
 * warrant, technical clauses stay redacted until the first signature,
 * then a less-redacted v2 regenerates for the second approver."
 *
 * PIVOT FROM THE ORIGINAL PLAN (documented honestly, not silently
 * substituted): docs/tegata-concept.md's original description implies
 * Foxit's redaction capability. Researched 2026-08-30 (real web search,
 * not guessed) — Foxit's actual redaction product is "Smart Redact,"
 * which is a Foxit PDF Editor+ plugin / "Smart Redact Server" cloud
 * product with its OWN subscription, NOT part of the eSign or PDF
 * Services REST APIs this project already has developer keys for. It
 * is not reachable the way foxitClient.ts/foxitPdfServicesClient.ts
 * reach their respective products. Rather than guess at an API that
 * doesn't exist for this purpose (the exact mistake this project's own
 * rules exist to prevent), this reuses Doctavian's ALREADY-CONFIRMED
 * conditional-paragraph templating (`<mdoc:paragraph name="X"
 * hidden="{!$expr}">`, proven working in the original warrant template
 * and reused as-is in tegata-runbook.docx) to achieve the same
 * end-user-visible outcome — a document whose visible content changes
 * based on where the warrant is in its approval lifecycle — without
 * needing a product this project doesn't have access to.
 *
 * Real limitation, also documented honestly rather than overclaimed:
 * this module only GENERATES a document at a given reveal_level; it is
 * NOT wired to automatically regenerate after a real first-signature
 * event in xano mode, because Phase 6's own known gap (apiClient.ts's
 * module docstring: Xano has no per-signature progress tracking, only
 * a final pending_approval -> active transition) means "the first of 2
 * signatures just landed" isn't a detectable event yet. Call this
 * manually with reveal_level: "redacted" at request time and
 * reveal_level: "full" once that gap is closed (or manually, for a
 * demo).
 */
import { readFile } from "fs/promises";
import path from "path";
import { downloadDocument, generateDocument, uploadData, uploadTemplate, DoctavianConfig } from "./doctavianClient";
import { buildWarrantVariables } from "./warrantVariables";

export type RevealLevel = "redacted" | "full";

export interface ProgressiveDisclosureInput {
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

export interface ProgressiveDisclosureResult {
  documentId: string;
  pdf: Buffer;
  documentHash: string;
  revealLevel: RevealLevel;
}

/** Generates the warrant document at a specific reveal_level. Only
 * meaningful for required_approver_count === 2 (a 1-approver warrant
 * has no "before the first signature" stage worth hiding anything for
 * — the same approver who'd see the redacted version is the only one
 * who ever signs it) — callers should gate on that themselves; this
 * function doesn't refuse a 1-approver input, it just wouldn't be used
 * for one in the intended flow. */
export async function generateProgressiveDisclosureDocument(config: DoctavianConfig, input: ProgressiveDisclosureInput, revealLevel: RevealLevel): Promise<ProgressiveDisclosureResult> {
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
  const variables = [...sharedVariables, { name: "warrant_id", value: input.warrantId }, { name: "reveal_level", value: revealLevel }];

  const templateFileName = "tegata-warrant-progressive.docx";
  const templateBuffer = await readFile(path.join(process.cwd(), "assets", templateFileName));
  const uploadedTemplate = await uploadTemplate(config, templateBuffer, templateFileName);
  const dataFields = Object.fromEntries(variables.map((v) => [v.name, v.value]));
  const uploadedData = await uploadData(config, { data: dataFields });

  const externalRequestId = `${input.warrantId}-${revealLevel}-${Date.now()}`;
  const generated = await generateDocument(config, {
    templateName: "Tegata Warrant (Progressive Disclosure)",
    templateUrn: uploadedTemplate.id,
    documentName: `warrant-${input.warrantId}-${revealLevel}`,
    variables,
    externalRequestId,
    dataUrn: uploadedData.id,
    documentFileFormat: "pdf",
  });
  const documentId = generated.urn;
  const pdf = await downloadDocument(config, documentId);

  const { createHash } = await import("crypto");
  return { documentId, pdf, documentHash: createHash("sha256").update(pdf).digest("hex"), revealLevel };
}
