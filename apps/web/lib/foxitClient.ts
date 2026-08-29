/**
 * Server-only TS port of apps/agent/src/tegata_agent/foxit_client.py —
 * ONLY create_envelope_from_binary and get_envelope_details, which is
 * all Tegata's real-signing pipeline needs. Auth headers/body shapes
 * copied verbatim from the Python client (see its module docstring for
 * why client_id/client_secret headers are used instead of the public
 * Postman collection's OAuth2 flow — confirmed against this project's
 * real dashboard curl sample).
 *
 * NEVER import from a "use client" component — reads FOXIT_ESIGN_*
 * env vars (server-only).
 *
 * UNVERIFIED (flagged honestly): never run against the real Foxit API
 * from this codebase yet — Claude's sandbox cannot reach
 * na1.fusion.foxit.com. In particular, the exact key holding the
 * embedded-signing URL in create_envelope_from_binary's response has
 * NOT been confirmed field-by-field (see extractSigningUrl below) —
 * confirm on first real run and fix the key name if it's wrong.
 */

export class FoxitAPIError extends Error {
  constructor(
    public status: number,
    message: string,
    public raw?: any
  ) {
    super(`Foxit API error ${status}: ${message}`);
  }
}

export interface FoxitConfig {
  clientId: string;
  clientSecret: string;
  baseUrl: string;
}

export function loadFoxitConfigFromEnv(): FoxitConfig {
  const clientId = process.env.FOXIT_ESIGN_API_KEY;
  const clientSecret = process.env.FOXIT_ESIGN_API_SECRET;
  const baseUrl = process.env.FOXIT_ESIGN_API_BASE_URL || "https://na1.fusion.foxit.com/esign/api";
  if (!clientId || !clientSecret) throw new Error("FOXIT_ESIGN_API_KEY / FOXIT_ESIGN_API_SECRET is not set");
  return { clientId, clientSecret, baseUrl };
}

function headers(config: FoxitConfig, withJsonContentType = true): Record<string, string> {
  return {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    Accept: "application/json",
    ...(withJsonContentType ? { "Content-Type": "application/json" } : {}),
  };
}

async function handleResponse(res: Response): Promise<any> {
  let data: any = {};
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) throw new FoxitAPIError(res.status, data?.message || res.statusText, data);
  return data;
}

export interface Party {
  firstName: string;
  lastName: string;
  email: string;
  sequence?: number;
  permission?: string;
}

export interface SignatureField {
  type: "text" | "date" | "signature" | "checkbox";
  x: number;
  y: number;
  width: number;
  height: number;
  pageNumber?: number;
  documentNumber?: number;
  party?: number;
  name?: string;
  required?: boolean;
}

function partyToBody(p: Party) {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    emailId: p.email,
    permission: p.permission ?? "FILL_FIELDS_AND_SIGN",
    sequence: p.sequence ?? 1,
    allowNameChange: false,
  };
}

function fieldToBody(f: SignatureField) {
  const d: any = {
    type: f.type,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    pageNumber: f.pageNumber ?? 1,
    documentNumber: f.documentNumber ?? 1,
    party: f.party ?? 1,
    required: f.required ?? true,
  };
  if (f.name) d.name = f.name;
  return d;
}

/** POST /v1/folders/createfolder (multipart) — uploads a PDF and
 * creates a signature envelope ("folder") in one call. Pass
 * createEmbeddedSigningSession: true to get back a hosted signing
 * link the demo can open directly, instead of relying on an email
 * round-trip (much better for a live hackathon demo). */
export async function createEnvelopeFromBinary(
  config: FoxitConfig,
  opts: {
    pdfBuffer: Buffer;
    pdfFileName: string;
    folderName: string;
    parties: Party[];
    fields: SignatureField[];
    sendNow?: boolean;
    createEmbeddedSigningSession?: boolean;
  }
): Promise<any> {
  const dataPayload = {
    folderName: opts.folderName,
    parties: opts.parties.map(partyToBody),
    fields: opts.fields.map(fieldToBody),
    sendNow: opts.sendNow ?? true,
    createEmbeddedSigningSession: opts.createEmbeddedSigningSession ?? true,
  };

  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(opts.pdfBuffer)], { type: "application/pdf" }), opts.pdfFileName);
  form.append("data", JSON.stringify(dataPayload));

  const res = await fetch(`${config.baseUrl}/v1/folders/createfolder`, {
    method: "POST",
    headers: headers(config, false),
    body: form,
  });
  return handleResponse(res);
}

/** GET /v1/folders/myfolder?folderId=X — folder status, parties,
 * fields, and audit trail. This is the call Xano's own signature
 * verification step should make (server-to-server, real status) —
 * NOT something the frontend should trust the client to report. */
export async function getEnvelopeDetails(config: FoxitConfig, folderId: string | number): Promise<any> {
  const url = new URL(`${config.baseUrl}/v1/folders/myfolder`);
  url.searchParams.set("folderId", String(folderId));
  const res = await fetch(url, { method: "GET", headers: headers(config, false) });
  return handleResponse(res);
}

/** Best-effort extraction of the embedded-signing URL from
 * create_envelope_from_binary's response. Foxit's exact response shape
 * for this field has not been confirmed against the real API — this
 * tries several plausible locations and returns null if none match,
 * so the caller can fall back to "check your email" messaging instead
 * of crashing. Fix this function's key names once a real response is
 * seen. */
export function extractSigningUrl(createFolderResponse: any): string | null {
  const r = createFolderResponse;
  return (
    r?.embeddedSigningUrl ??
    r?.signingUrl ??
    r?.result?.embeddedSigningUrl ??
    r?.parties?.[0]?.embeddedSigningUrl ??
    r?.parties?.[0]?.signingUrl ??
    null
  );
}
