import { NextResponse } from "next/server";
import { getWarrant } from "../../../../../lib/mockStore";

export async function GET(_req: Request, { params }: { params: { warrantId: string } }) {
  const warrant = await getWarrant(params.warrantId);
  if (!warrant) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json({ warrant });
}
