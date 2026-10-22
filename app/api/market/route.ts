import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { MARKET_KEY } from "@/lib/market";
import { pushTokenMatches, sessionRole } from "@/lib/session";

const MAX_BYTES = 512 * 1024;

// The /market page reads the latest snapshot. Prices, demand and radar are computed in driftae-ops (`dt market push`),
// so the bots' answers, the card and this page always show the same numbers.
export async function GET(request: NextRequest) {
  if (!sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ snapshot: (await getKvClient().get(MARKET_KEY)) ?? null });
}

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  let body: { built?: string; prices?: unknown[]; demand?: unknown; radar?: unknown[] };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.built || !Array.isArray(body.prices) || !body.demand || !Array.isArray(body.radar)) {
    return NextResponse.json({ error: "Missing built/prices/demand/radar" }, { status: 400 });
  }
  await getKvClient().set(MARKET_KEY, body);
  return NextResponse.json({ success: true });
}
