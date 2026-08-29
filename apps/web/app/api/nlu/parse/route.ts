/**
 * POST /api/nlu/parse — Phase 4's AI front-door, wired into the demo UI.
 * Runs entirely in this app (not Xano): it's pure LLM-call + validation
 * logic with no persistent state, so there's no binary pass-through
 * problem like /api/documents/prepare has, and no real benefit to
 * routing it through Xano's Function Stack — see PROJECT_STATUS.md for
 * why this one stayed in Next.js rather than getting a Xano spec like
 * §13's Doctavian/Foxit split did.
 *
 * Input: { text: string } — free-text access request.
 * Output on success: { candidate: AccessRequestCandidate, concerns:
 * string | null }. The frontend still has to actually call
 * createWarrant() itself with the returned candidate — this route only
 * proposes, exactly like nlu_frontdoor.py's own module docstring says.
 * Output on failure: { error: "extraction_failed" | "validation_failed"
 * | "all_providers_failed" | "config_error", message, ...extra } —
 * validation_failed includes raw_data so the UI can show the user what
 * the LLM actually produced and let them fix it manually instead of
 * dead-ending.
 */
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { buildDefaultFallbackClient, AllProvidersFailedError } from "../../../../lib/llmClient";
import { processNaturalLanguageRequest, NLUExtractionError, RequestValidationError } from "../../../../lib/nluFrontdoor";

export async function POST(req: NextRequest) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body.text || !body.text.trim()) {
    return NextResponse.json({ error: "validation_failed", message: "text is required" }, { status: 400 });
  }

  let llm;
  try {
    llm = buildDefaultFallbackClient();
  } catch (err: any) {
    return NextResponse.json(
      { error: "config_error", message: "No LLM provider configured — set at least one of GEMINI_API_KEY / GROQ_API_KEY / OPENROUTER_API_KEY in apps/web/.env.local." },
      { status: 500 }
    );
  }

  try {
    const result = await processNaturalLanguageRequest(llm, body.text);
    return NextResponse.json({ candidate: result.validatedRequest, concerns: result.concernsFlaggedByLLM });
  } catch (err: any) {
    if (err instanceof RequestValidationError) {
      return NextResponse.json({ error: "validation_failed", message: err.message, raw_data: err.rawData }, { status: 422 });
    }
    if (err instanceof NLUExtractionError) {
      return NextResponse.json({ error: "extraction_failed", message: err.message }, { status: 502 });
    }
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json({ error: "all_providers_failed", message: err.message }, { status: 502 });
    }
    return NextResponse.json({ error: "unknown_error", message: err.message ?? String(err) }, { status: 500 });
  }
}
