import { NextRequest, NextResponse } from "next/server";
import { EnvelopeNotExecutedError, InvalidTransitionError, ReplayRejectedError, SignatureMismatchError } from "../../../../../../lib/referenceLogic";
import { signWarrant } from "../../../../../../lib/mockStore";

export async function POST(req: NextRequest, { params }: { params: { warrantId: string } }) {
  const body = await req.json().catch(() => ({}));
  const signerEmail: string = body.signer_email || "approver@example.com";

  try {
    const warrant = await signWarrant(params.warrantId, signerEmail);
    return NextResponse.json({ warrant });
  } catch (err) {
    // Error shapes intentionally mirror docs/xano-setup.md §9a so the UI's
    // error handling here is a preview of what real Xano mode will return.
    if (err instanceof ReplayRejectedError) {
      return NextResponse.json({ error: "replay_rejected", warrant_id: err.warrantId, message: err.message }, { status: 403 });
    }
    if (err instanceof EnvelopeNotExecutedError) {
      return NextResponse.json({ error: "envelope_not_executed", message: err.message }, { status: 409 });
    }
    if (err instanceof SignatureMismatchError) {
      return NextResponse.json({ error: "signature_mismatch", message: err.message }, { status: 409 });
    }
    if (err instanceof InvalidTransitionError) {
      return NextResponse.json({ error: "invalid_transition", current: err.current, target: err.target }, { status: 409 });
    }
    return NextResponse.json({ error: "internal_error", message: String(err) }, { status: 500 });
  }
}
