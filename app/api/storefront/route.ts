import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { catalogData } from "@/lib/db";

// Public, read-only feed for www.driftae.com: per product only the shop price and the live Trade Me listing id.
// Price = the team's /catalog price, else the live Trade Me price. No names, orders or anything about customers.
// The server refreshes listing ids every 30 minutes (dt catalog sync → /api/catalog/status), so relists and price
// changes reach the site without a deploy.
// 2026-11-15: without this Next 14 served the 2026-11-08 answer for a week (every buy link pointed at an ended listing)
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store"; // the Neon driver queries over fetch (POST), which Next 14 cached too
export const revalidate = 0;

const ORIGINS = new Set(["https://www.driftae.com", "https://driftae.com", "http://localhost:4173", "http://localhost:5173"]);
const LIVE = new Set(["listed", "listed_new", "price_updated"]);

function cors(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
}

export async function GET(request: NextRequest) {
  noStore();
  try {
    const { prices, status } = await catalogData();
    const out: Record<string, { price?: number; listingId?: string }> = {};
    for (const s of status) {
      if (LIVE.has(s.state) && s.listing_id) {
        out[s.product_id] = { listingId: String(s.listing_id), ...(s.tm_price ? { price: Number(s.tm_price) } : {}) };
      }
    }
    for (const p of prices) {
      if (p.price != null) out[p.product_id] = { ...out[p.product_id], price: Number(p.price) };
    }
    const updated = status.reduce((m, s) => (s.at > m ? s.at : m), "");
    return NextResponse.json({ updated, products: out }, {
      headers: { ...cors(request), "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch {
    return NextResponse.json({ error: "Catalogue unavailable" }, { status: 503, headers: cors(request) });
  }
}
