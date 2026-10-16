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

// PUT: anyone on the team sets prices (admin or viewer login: the three of them have the same rights). A saved price
// is the approval: the server lists the product on Trade Me (if ticked) or changes the live price within 30 minutes.
// The driftae-ops server writes here too, but only after `dt catalog reprice` has checked the WeChat approval code of
// the person who asked ("所有的涨 5%" → 改价 <code>); updatedBy names that person's bot.
export async function PUT(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  const role = server ? null : sessionRole(request);
  if (!server && !role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const id = String(b.product_id ?? "");
  const price = b.price === null || b.price === "" || b.price === undefined ? null : Number(b.price);
  if (!/^[\w-]{1,120}$/.test(id) || (price !== null && !(price >= 50 && price <= 2000))) {
    return NextResponse.json({ error: "价格要在 $50 到 $2000 之间" }, { status: 400 });
  }
  const title = typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 80) : null;
  await setCatalogPrice({ product_id: id, price: price === null ? null : Math.round(price * 100) / 100,
                          list_on_trademe: Boolean(b.list_on_trademe), title,
                          updated_by: role ?? `bot:${String(b.updatedBy ?? "").replace(/[^\w-]/g, "").slice(0, 40) || "server"}` });
  return NextResponse.json({ success: true });
}
