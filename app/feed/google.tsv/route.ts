import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { pushTokenMatches } from "@/lib/session";

// Google Merchant Center's product file (owner 2026-11-17): Merchant Center fetches this URL on a schedule.
// The driftae-ops server builds it (`dt merchant feed --push`, every 30 min) and posts it here. Public: it holds only
// what the storefront already shows (title, price, photo, link).
export const dynamic = "force-dynamic";

const KEY = "merchant:google-feed";
const MAX_BYTES = 2 * 1024 * 1024;

export async function GET() {
  const tsv = await getKvClient().get<string>(KEY);
  if (!tsv) return new NextResponse("not built yet", { status: 404 });
  return new NextResponse(tsv, { headers: { "Content-Type": "text/tab-separated-values; charset=utf-8", "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json().catch(() => null);
  const tsv = typeof b?.tsv === "string" ? b.tsv : "";
  if (!tsv.startsWith("id\t") || tsv.length > MAX_BYTES) return NextResponse.json({ error: "Need tsv starting with the id column" }, { status: 400 });
  await getKvClient().set(KEY, tsv);
  return NextResponse.json({ success: true, rows: tsv.trim().split("\n").length - 1 });
}
