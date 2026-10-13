import { NextRequest, NextResponse } from "next/server";
import { CatalogStatus, saveCatalogStatus } from "@/lib/db";
import { pushTokenMatches } from "@/lib/session";

// The driftae-ops server reports what it did with each product (listed, repriced, error) after every sync.
export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = (await request.json().catch(() => null)) as CatalogStatus[] | null;
  if (!Array.isArray(rows) || rows.length > 2000) return NextResponse.json({ error: "Bad body" }, { status: 400 });
  await saveCatalogStatus(rows.filter((r) => r && typeof r.product_id === "string").map((r) => ({
    product_id: r.product_id.slice(0, 120), state: String(r.state).slice(0, 40), listing_id: r.listing_id ?? null,
    tm_price: r.tm_price ?? null, message: r.message ? String(r.message).slice(0, 300) : null,
    title: r.title ? String(r.title).slice(0, 80) : null, at: String(r.at).slice(0, 40) })));
  return NextResponse.json({ success: true });
}
