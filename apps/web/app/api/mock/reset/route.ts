import { NextResponse } from "next/server";
import { __resetMockStoreForTests } from "../../../../lib/mockStore";

/** Test-only. Real Xano mode has no equivalent — resetting a real backend
 * between test runs isn't this app's job. Only meaningful in mock mode. */
export async function POST() {
  __resetMockStoreForTests();
  return NextResponse.json({ ok: true });
}
