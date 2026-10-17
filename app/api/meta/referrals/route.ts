import { NextRequest, NextResponse } from "next/server";
import { listReferrals } from "@/lib/db";
import { pushTokenMatches } from "@/lib/session";

// The driftae-ops server (Bearer METRICS_PUSH_TOKEN) reads where Messenger conversations came from (?after=id).
export async function GET(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const after = Number(request.nextUrl.searchParams.get("after") ?? 0) || 0;
  return NextResponse.json({ referrals: await listReferrals(after) });
}
