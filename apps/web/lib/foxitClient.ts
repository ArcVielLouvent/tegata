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
  // Foxit's confirmed real error shape (from a live curl test, 2026-08-30):
  // {"result":"error","error_description":"invalid folder id"} — note
  // error_description, NOT message. This was being missed entirely,
  // silently falling back to the generic HTTP status text for every
  // Foxit error instead of the actual reason.
  if (!res.ok) {
    throw new FoxitAPIError(res.status, data?.error_description || data?.message || res.statusText, data);
  }
  // Foxit apparently can return HTTP 200 with a body-level error
  // (result: "error") rather than a non-2xx status — confirmed by the
  // same curl test (invalid folder id came back as HTTP 200). Treat
  // that as a failure too, or callers checking only res.ok will think
  // a body-level error succeeded.
  if (data?.result === "error") {
    throw new FoxitAPIError(res.status, data?.error_description || "Foxit returned result: error with no error_description", data);
  }
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
  /** REQUIRED for type:"text" per Foxit's own confirmed dashboard
   * sample (2026-08-30) — every text field in their real example has
   * this, distinct from `name`. Not confirmed whether it's genuinely
   * required by the API or just always present by convention in their
   * sample; included to match rather than omit and guess wrong again. */
  textFieldName?: string;
  characterLimit?: number;
}

function partyToBody(p: Party, index: number) {
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    emailId: p.email,
    permission: p.permission ?? "FILL_FIELDS_AND_SIGN",
    sequence: p.sequence ?? 1,
    allowNameChange: false,
  };
}

/** Field shape confirmed against Foxit's own real dashboard code
 * sample (2026-08-30) — this was previously missing textfieldName,
 * tabOrder, and partyResponsible entirely, sending only a small subset
 * of what their own example includes for every field. Whether the
 * missing ones were actually REQUIRED (as opposed to Foxit tolerating
 * their absence) is not separately confirmed — but matching the known-
 * working shape exactly is safer than continuing to guess which subset
 * is optional. */
function fieldToBody(f: SignatureField, index: number) {
  const d: any = {
    type: f.type,
    x: f.x,
    y: f.y,
    width: f.width,
    height: f.height,
    pageNumber: f.pageNumber ?? 1,
    documentNumber: f.documentNumber ?? 1,
    tabOrder: index + 1,
    party: f.party ?? 1,
    partyResponsible: f.party ?? 1,
    required: f.required ?? true,
  };
  if (f.name) d.name = f.name;
  if (f.type === "text") {
    d.textfieldName = f.textFieldName ?? f.name ?? `field_${index + 1}`;
    d.characterLimit = f.characterLimit ?? 100;
    d.fontSize = 12;
    d.fontFamily = "default";
    d.fontColor = "#000000";
  }
  return d;
}

/** POST /v1/folders/createfolder (JSON body, inputType: "base64") —
 * creates a signature envelope ("folder") from an in-memory PDF. Pass
 * createEmbeddedSigningSession: true to get back a hosted signing link
 * the demo can open directly, instead of relying on an email
 * round-trip (much better for a live hackathon demo).
 *
 * CHANGED 2026-08-30: previously sent the PDF as multipart/form-data,
 * which returned a real 403 in live testing. Confirmed via Foxit's own
 * developer docs (developersguide.foxitesign.foxit.com) and multiple
 * third-party integration guides (n8n, MCP server examples) that
 * `inputType: "base64"` + a `base64FileString` array (paired with a
 * matching `fileNames` array) is the documented method for files that
 * aren't at a public URL — exactly our situation, since Doctavian
 * generates the PDF in-memory on our own server with no public hosting.
 * client_id/client_secret headers (not the OAuth Bearer token these
 * docs otherwise show) are kept as-is — confirmed working via a live
 * curl test against this project's actual account, which takes
 * precedence over generic documentation. */
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
    inputType: "base64",
    base64FileString: [opts.pdfBuffer.toString("base64")],
    fileNames: [opts.pdfFileName],
    parties: opts.parties.map((p, i) => partyToBody(p, i)),
    fields: opts.fields.map((f, i) => fieldToBody(f, i)),
    sendNow: opts.sendNow ?? true,
    createEmbeddedSigningSession: opts.createEmbeddedSigningSession ?? true,
  };

  const res = await fetch(`${config.baseUrl}/v1/folders/createfolder`, {
    method: "POST",
    headers: headers(config, true),
    body: JSON.stringify(dataPayload),
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
