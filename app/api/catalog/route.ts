import { NextRequest, NextResponse } from "next/server";
import { catalogData, setCatalogPrice } from "@/lib/db";
import { pushTokenMatches, sessionRole } from "@/lib/session";

// GET: everyone logged in sees prices and Trade Me state; the driftae-ops server reads them with its token.
export async function GET(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization")) && !sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await catalogData());
}

// PUT: only the owner (admin password) sets prices. A saved price is the approval: the server lists the product
// on Trade Me (if ticked) or changes the live Trade Me price within 30 minutes.
export async function PUT(request: NextRequest) {
  if (sessionRole(request) !== "admin") {
    return NextResponse.json({ error: "只有管理员可以改价格" }, { status: 403 });
  }
  const b = await request.json().catch(() => ({}));
  const id = String(b.product_id ?? "");
  const price = b.price === null || b.price === "" || b.price === undefined ? null : Number(b.price);
  if (!/^[\w-]{1,120}$/.test(id) || (price !== null && !(price >= 50 && price <= 2000))) {
    return NextResponse.json({ error: "价格要在 $50 到 $2000 之间" }, { status: 400 });
  }
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 80) : null;
  await setCatalogPrice({ product_id: id, price: price === null ? null : Math.round(price * 100) / 100,
                          list_on_trademe: Boolean(b.list_on_trademe), title, updated_by: "admin" });
  return NextResponse.json({ success: true });
}
