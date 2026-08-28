import { NextResponse } from "next/server";
import { verifyChain, ChainIntegrityError } from "../../../../../../lib/referenceLogic";
import { getAuditLog } from "../../../../../../lib/mockStore";

export async function GET(_req: Request, { params }: { params: { warrantId: string } }) {
  const entries = await getAuditLog(params.warrantId);
  let chainIntact = true;
  let brokenAt: number | null = null;
  try {
    await verifyChain(entries);
  } catch (err) {
    if (err instanceof ChainIntegrityError) {
      chainIntact = false;
      brokenAt = err.index;
    } else {
      throw err;
    }
  }
  return NextResponse.json({ entries, chain_intact: chainIntact, broken_at_index: brokenAt });
}
