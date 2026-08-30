/**
 * Server-only TS client for Foxit's PDF Services API — structural
 * extraction (OCR + layout + AI parsing) endpoint only, which is all
 * Stretch B (OCR self-consistency check, ROADMAP.md Phase 7 #2) needs.
 *
 * IMPORTANT — this is a DIFFERENT Foxit product from foxitClient.ts:
 * foxitClient.ts talks to the eSign API (na1.fusion.foxit.com/esign/api).
 * This file talks to the PDF Services API
 * (na1.fusion.foxit.com/pdf-services/api) — same base domain, different
 * path prefix. Confirmed via a real fetch of Foxit's own developer blog
 * (developer-api.foxit.com, 2026-08-30), not guessed — full 4-step flow,
 * request/response shapes, and error codes below are copied verbatim
 * from that article's own cURL/Python examples, which is a first for
 * this project's Foxit integration (every previous Foxit guess had to
 * be corrected after a real 403/error; this one starts from a
 * confirmed source).
 *
 * UNCONFIRMED (the one real gap): whether FOXIT_ESIGN_API_KEY/
 * FOXIT_ESIGN_API_SECRET (this project's existing eSign credentials)
 * also work here. The source article says both header values "come
 * from the Developer Portal's default application," which suggests a
 * single Foxit developer account's credentials may span both products
 * — but that's an inference from the article's wording, not something
 * this project has tested. Try the existing FOXIT_ESIGN_API_KEY/SECRET
 * first (loadFoxitPdfServicesConfigFromEnv() defaults to them); if
 * every call 401s, a separate PDF Services—specific credential pair
 * may be needed instead (same account, different application in the
 * Developer Portal, or Foxit PDF Services API and eSign API might just
 * need enabling separately per account).
 *
 * NEVER import from a "use client" component.
 */

export class FoxitPdfServicesError extends Error {
  constructor(
    public code: string | null,
    message: string,
    public raw?: any
  ) {
    super(`Foxit PDF Services API error (${code}): ${message}`);
  }
}

export interface FoxitPdfServicesConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export function loadFoxitPdfServicesConfigFromEnv(): FoxitPdfServicesConfig {
  // Defaults to the SAME env vars as foxitClient.ts's eSign config —
  // see this file's module docstring for why that's a reasonable first
  // guess, not a confirmed fact. Override with FOXIT_PDF_SERVICES_*
  // if it turns out a separate credential pair is actually needed.
  const clientId = process.env.FOXIT_PDF_SERVICES_API_KEY || process.env.FOXIT_ESIGN_API_KEY;
  const clientSecret = process.env.FOXIT_PDF_SERVICES_API_SECRET || process.env.FOXIT_ESIGN_API_SECRET;
  const baseUrl = process.env.FOXIT_PDF_SERVICES_API_BASE_URL || "https://na1.fusion.foxit.com/pdf-services/api";
  if (!clientId || !clientSecret) throw new Error("FOXIT_PDF_SERVICES_API_KEY/SECRET (or the FOXIT_ESIGN_API_KEY/SECRET fallback) is not set");
  return { clientId, clientSecret, baseUrl };
}

function headers(config: FoxitPdfServicesConfig, withJsonContentType = false): Record<string, string> {
  // Lowercase snake_case header names, confirmed verbatim from Foxit's
  // own docs — NOT "Authorization: Bearer", explicitly called out as a
  // common mistake in the source article.
  return {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    ...(withJsonContentType ? { "Content-Type": "application/json" } : {}),
  };
}

async function parseErrorBody(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function throwIfError(res: Response, data: any): void {
  if (!res.ok) throw new FoxitPdfServicesError(data?.code ?? null, data?.message || res.statusText, data);
}

/** Step 1: POST /documents/upload (multipart, field "file"). Returns
 * documentId. 100MB ceiling, 413 MAX_UPLOAD_SIZE_EXCEEDED if over. */
export async function uploadDocument(config: FoxitPdfServicesConfig, pdfBuffer: Buffer, fileName: string): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(pdfBuffer)], { type: "application/pdf" }), fileName);
  const res = await fetch(`${config.baseUrl}/documents/upload`, { method: "POST", headers: headers(config, false), body: form });
  const data = await parseErrorBody(res);
  throwIfError(res, data);
  return data.documentId;
}

/** Step 2: POST /documents/pdf-structural-extract. 202 Accepted with
 * taskId — this is the START of an async job, not the result. */
export async function startStructuralExtraction(config: FoxitPdfServicesConfig, documentId: string, password?: string): Promise<string> {
  const body: any = { documentId };
  if (password) body.password = password;
  const res = await fetch(`${config.baseUrl}/documents/pdf-structural-extract`, {
    method: "POST",
    headers: headers(config, true),
    body: JSON.stringify(body),
  });
  const data = await parseErrorBody(res);
  throwIfError(res, data);
  return data.taskId;
}

export interface TaskStatus {
  taskId: string;
  status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED";
  progress: number;
  resultDocumentId?: string;
  error?: { code: string; message: string };
}

/** Step 3: GET /tasks/{taskId}. One poll — call this in a loop with a
 * delay, same pattern as Foxit's own n8n/Python examples (2s interval
 * suggested in their docs). */
export async function getTaskStatus(config: FoxitPdfServicesConfig, taskId: string): Promise<TaskStatus> {
  const res = await fetch(`${config.baseUrl}/tasks/${encodeURIComponent(taskId)}`, { method: "GET", headers: headers(config, false) });
  const data = await parseErrorBody(res);
  throwIfError(res, data);
  return data;
}

/** Polls until COMPLETED or FAILED. maxWaitMs bounds total wait —
 * extraction is a real async job on Foxit's side with no documented
 * SLA, so this needs a ceiling the same way llmClient.ts's provider
 * calls needed a per-request timeout (see that file's own comments on
 * why an unbounded wait is a real bug, not just theoretical). */
export async function pollUntilDone(config: FoxitPdfServicesConfig, taskId: string, opts: { intervalMs?: number; maxWaitMs?: number } = {}): Promise<TaskStatus> {
  const intervalMs = opts.intervalMs ?? 2000;
  const maxWaitMs = opts.maxWaitMs ?? 60_000;
  const start = Date.now();
  while (true) {
    const status = await getTaskStatus(config, taskId);
    if (status.status === "COMPLETED" || status.status === "FAILED") return status;
    if (Date.now() - start > maxWaitMs) {
      throw new FoxitPdfServicesError("CLIENT_TIMEOUT", `Extraction task ${taskId} did not complete within ${maxWaitMs}ms (last status: ${status.status}, progress: ${status.progress})`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Step 4: GET /documents/{resultDocumentId}/download. Returns the
 * raw ZIP bytes — caller unzips (see extractStructureInfoFromZip in
 * ocrConsistencyCheck.ts, kept separate so this file stays a thin,
 * mechanical port of the 4 REST calls with no parsing logic mixed in). */
export async function downloadResult(config: FoxitPdfServicesConfig, resultDocumentId: string): Promise<Buffer> {
  const res = await fetch(`${config.baseUrl}/documents/${encodeURIComponent(resultDocumentId)}/download`, { method: "GET", headers: headers(config, false) });
  if (!res.ok) {
    const data = await parseErrorBody(res);
    throwIfError(res, data);
  }
  return Buffer.from(await res.arrayBuffer());
}

/** Runs all 4 steps in sequence — the common case. */
export async function extractStructure(config: FoxitPdfServicesConfig, pdfBuffer: Buffer, fileName: string, opts: { password?: string; pollIntervalMs?: number; maxWaitMs?: number } = {}): Promise<Buffer> {
  const documentId = await uploadDocument(config, pdfBuffer, fileName);
  const taskId = await startStructuralExtraction(config, documentId, opts.password);
  const finalStatus = await pollUntilDone(config, taskId, { intervalMs: opts.pollIntervalMs, maxWaitMs: opts.maxWaitMs });
  if (finalStatus.status === "FAILED" || !finalStatus.resultDocumentId) {
    throw new FoxitPdfServicesError(finalStatus.error?.code ?? "EXTRACTION_FAILED", finalStatus.error?.message ?? "Extraction task failed with no error detail", finalStatus);
  }
  return downloadResult(config, finalStatus.resultDocumentId);
}
