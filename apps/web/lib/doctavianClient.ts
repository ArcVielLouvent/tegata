/**
 * Server-only TS port of apps/agent/src/tegata_agent/doctavian_client.py —
 * ONLY the methods Tegata's generate-document pipeline actually uses
 * (upload_template, upload_data, generate_document, download_document).
 * Endpoint paths, header names, and error shapes are copied verbatim from
 * the Python client, which was itself built against Doctavian's real
 * Postman collection (see doctavian_client.py's module docstring) — not
 * re-derived or guessed here.
 *
 * NEVER import this from a "use client" component — it reads
 * DOCTAVIAN_* env vars (no NEXT_PUBLIC_ prefix, server-only by Next.js
 * convention) and is only meant to run inside app/api/documents/prepare's
 * route handler (Node.js runtime).
 *
 * UNVERIFIED (flagged honestly, not assumed): this file has never been
 * run against the real Doctavian API — Claude's sandbox cannot reach
 * demo.api.doctavian.com. Run scripts/verify_doctavian_frontend.mjs (or
 * just the actual Requester -> Approver flow) locally before trusting it.
 */

export class DoctavianAPIError extends Error {
  constructor(
    public status: number,
    public code: string | null,
    message: string,
    public raw?: any
  ) {
    super(`Doctavian API error ${status} (${code}): ${message}`);
  }
}

export interface DoctavianConfig {
  apiKey: string;
  baseUrl: string;
  accessToken?: string;
}

export function loadDoctavianConfigFromEnv(): DoctavianConfig {
  const apiKey = process.env.DOCTAVIAN_API_KEY;
  const accessToken = process.env.DOCTAVIAN_ACCESS_TOKEN;
  const baseUrl = process.env.DOCTAVIAN_API_BASE_URL || "https://demo.api.doctavian.com";
  if (!apiKey) throw new Error("DOCTAVIAN_API_KEY is not set");
  if (!accessToken) {
    throw new Error(
      "DOCTAVIAN_ACCESS_TOKEN is not set — this is a short-lived OAuth token obtained manually via " +
        "Postman's 'Get New Access Token' button (see .env.example). Re-generate and update .env.local when it expires."
    );
  }
  return { apiKey, baseUrl, accessToken };
}

function jsonHeaders(config: DoctavianConfig): Record<string, string> {
  return {
    "x-api-key": config.apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
  };
}

function uploadHeaders(config: DoctavianConfig, storageType: string): Record<string, string> {
  return {
    "x-api-key": config.apiKey,
    Accept: "application/json",
    "X-Storage-Type": storageType,
    ...(config.accessToken ? { Authorization: `Bearer ${config.accessToken}` } : {}),
    // Deliberately no Content-Type — fetch sets the multipart boundary
    // automatically when the body is a FormData instance.
  };
}

async function parseErrorBody(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function throwDoctavianError(status: number, data: any): never {
  if (data && data.error) {
    const inner = data.error;
    const firstInner = (inner.innerErrors || [])[0] || {};
    throw new DoctavianAPIError(status, firstInner.code ?? null, firstInner.userMessage || inner.message || "Unknown error", data);
  }
  throw new DoctavianAPIError(status, data?.code ?? null, data?.message || "Unknown error", data);
}

/** POST /v1/documents/template/upload — returns { id, fileName }. The
 * returned id is used directly as generate_document's template.urn.
 * Per Doctavian's docs, uploaded templates are auto-deleted from
 * Storage after the next generate call consumes them — re-upload
 * fresh each time, don't cache the id. */
export async function uploadTemplate(config: DoctavianConfig, fileBuffer: Buffer, fileName: string): Promise<{ id: string; fileName: string }> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(fileBuffer)]), fileName);
  const res = await fetch(`${config.baseUrl}/v1/documents/template/upload`, {
    method: "POST",
    headers: uploadHeaders(config, "document-template"),
    body: form,
  });
  const data = await parseErrorBody(res);
  if (!res.ok) throwDoctavianError(res.status, data);
  return data.result.data.files[0];
}

/** POST /v1/documents/data/upload — same lifecycle as uploadTemplate.
 * fields should already be wrapped as {"data": {...}} by the caller
 * (Kanwal's 2026-08-25 TEMPLATE_READ_FAILED fix — the wrapper key is
 * required regardless of templating approach). */
export async function uploadData(config: DoctavianConfig, dataObject: Record<string, unknown>, fileName = "data.json"): Promise<{ id: string; fileName: string }> {
  const buffer = Buffer.from(JSON.stringify(dataObject), "utf-8");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: "application/json" }), fileName);
  const res = await fetch(`${config.baseUrl}/v1/documents/data/upload`, {
    method: "POST",
    headers: uploadHeaders(config, "document-data"),
    body: form,
  });
  const data = await parseErrorBody(res);
  if (!res.ok) throwDoctavianError(res.status, data);
  return data.result.data.files[0];
}

export interface TemplateVariable {
  name: string;
  value: string;
  type?: "fieldExpression" | "graphql" | "global";
}

/** POST /v1/documents/document/generate. documentFileFormat defaults to
 * "pdf" here (NOT "docx", unlike the Python client's default) because
 * this pipeline's whole point is feeding the output straight into
 * Foxit's create_envelope_from_binary, which expects a PDF. Whether
 * Doctavian actually honors documentFileFormat: "pdf" for a .docx
 * template is UNVERIFIED — flagged in doctavianClient's module
 * docstring, confirm on first real run before trusting it. */
export async function generateDocument(
  config: DoctavianConfig,
  opts: {
    templateName: string;
    templateUrn: string;
    documentName: string;
    variables: TemplateVariable[];
    externalRequestId: string;
    dataUrn?: string;
    documentFileFormat?: "pdf" | "docx";
  }
): Promise<{ urn: string; [key: string]: any }> {
  const body: any = {
    externalContext: { id: opts.externalRequestId },
    template: { name: opts.templateName, urn: opts.templateUrn, fileFormat: "docx", loadMethod: "Storage" },
    data: { loadMethod: "Storage", variables: opts.variables.map((v) => ({ name: v.name, value: v.value, type: v.type ?? "global" })) },
    document: {
      name: opts.documentName,
      fileFormat: opts.documentFileFormat ?? "pdf",
      deliveryMethod: "Storage",
      path: "root",
      locale: "en",
      timezone: "UTC",
    },
  };
  if (opts.dataUrn) body.data.urn = opts.dataUrn;

  const res = await fetch(`${config.baseUrl}/v1/documents/document/generate`, {
    method: "POST",
    headers: jsonHeaders(config),
    body: JSON.stringify(body),
  });
  const data = await parseErrorBody(res);
  if (!res.ok) throwDoctavianError(res.status, data);
  return data.result.data.document;
}

/** GET /v1/documents/document/{documentId}/download — returns raw file
 * bytes. documentId is generate_document()'s returned `urn`, passed
 * back verbatim. */
export async function downloadDocument(config: DoctavianConfig, documentId: string): Promise<Buffer> {
  const headers = jsonHeaders(config);
  delete headers["Content-Type"];
  const res = await fetch(`${config.baseUrl}/v1/documents/document/${encodeURIComponent(documentId)}/download`, {
    method: "GET",
    headers,
  });
  if (!res.ok) {
    const data = await parseErrorBody(res);
    throwDoctavianError(res.status, data);
  }
  return Buffer.from(await res.arrayBuffer());
}
