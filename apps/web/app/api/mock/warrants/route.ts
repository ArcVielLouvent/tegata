import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { createWarrant, listWarrants } from "../../../../lib/mockStore";

export async function GET() {
  const warrants = await listWarrants();
  return NextResponse.json({ warrants });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    const warrant = await createWarrant(body);
    return NextResponse.json({ warrant }, { status: 201 });
  } catch (err) {
    if (err instanceof ZodError) {
      // Mirrors the hard schema gate's role elsewhere in this project
      // (nlu_frontdoor.validate_and_build_request): reject malformed
      // input deterministically, don't try to be lenient about it.
      return NextResponse.json({ error: "validation_failed", details: err.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "internal_error", message: String(err) }, { status: 500 });
  }
}
