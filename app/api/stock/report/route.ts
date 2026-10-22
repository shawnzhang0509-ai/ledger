import { NextRequest, NextResponse } from "next/server";
import { loadStockReport } from "@/lib/books-server";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// Stock in one read: every car with its landed cost, totals, things to check. The /stock page and the
// bots (`dt stock list|gaps|report`) read the same numbers.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await loadStockReport());
}
