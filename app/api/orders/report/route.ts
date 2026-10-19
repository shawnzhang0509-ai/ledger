import { NextRequest, NextResponse } from "next/server";
import { loadBooks } from "@/lib/books-server";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// The books in one read: per-sale cost breakdown, missing costs, numbers to check, monthly totals.
// For the bots (Bearer METRICS_PUSH_TOKEN, `dt orders report`) and a signed-in admin. No customer names.
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await loadBooks());
}
