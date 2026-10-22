import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { DEMAND_KEY } from "@/lib/market";
import { loadMarketReport } from "@/lib/market-server";
import { pushTokenMatches, sessionRole } from "@/lib/session";

export const dynamic = "force-dynamic";
const MAX_BYTES = 256 * 1024;

// GET: the market report (/market page, `dt market report`). Computed here from the market records, so the page,
// the card and the bots read the same numbers.
export async function GET(request: NextRequest) {
  if (!sessionRole(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await loadMarketReport());
}

// POST: demand per car family, which the driftae-ops server computes from what only it has (Trade Me daily views,
// sales matched to products) and pushes with `dt market push` every 30 min.
export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: { built?: string; families?: unknown[]; products?: unknown[] };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.built || !Array.isArray(body.families) || !Array.isArray(body.products)) {
    return NextResponse.json({ error: "Need built, families, products" }, { status: 400 });
  }
  await getKvClient().set(DEMAND_KEY, body);
  return NextResponse.json({ success: true });
}
