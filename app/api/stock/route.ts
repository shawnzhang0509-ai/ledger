import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { STOCK_KEY, StockItem, normalizeStock } from "@/lib/stock";
import { isAuthenticated } from "@/lib/session";

// The /stock page (signed-in admin): people may change any value here, bots only go through /api/stock/bot.
// Selling and returning go through the bot actions too, so a cost always moves between stock and the books.
export const dynamic = "force-dynamic";

const EDITABLE = ["model", "brand", "scale", "ref", "purchaseCostCny", "exchangeRate", "purchaseCost", "airFreight",
  "courierCost", "status", "location", "acquiredAt", "listingId", "orderId", "notes"] as const;

function pick(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of EDITABLE) if (k in body) out[k] = body[k];
  return out as Partial<StockItem>;
}

async function load() {
  return ((await getKvClient().get<StockItem[]>(STOCK_KEY)) || []).map(normalizeStock);
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await load());
}

export async function POST(request: NextRequest) {
  if (!isAuthenticated(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body?.model) return NextResponse.json({ error: "需要车型" }, { status: 400 });
  const now = new Date().toISOString();
  const stock = await load();
  const item = normalizeStock({ location: "NZ", ...pick(body), id: crypto.randomUUID(), createdAt: now, updatedAt: now });
  stock.push(item);
  await getKvClient().set(STOCK_KEY, stock);
  return NextResponse.json(item, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  if (!isAuthenticated(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => null);
  const stock = await load();
  const at = stock.findIndex((s) => s.id === body?.id);
  if (at < 0) return NextResponse.json({ error: "没有这台车" }, { status: 404 });
  const next = { ...stock[at], ...pick(body), updatedAt: new Date().toISOString() };
  if (next.status === "Sold" && !next.soldAt) next.soldAt = new Date().toISOString().slice(0, 10);
  stock[at] = normalizeStock(next);
  await getKvClient().set(STOCK_KEY, stock);
  return NextResponse.json(stock[at]);
}

export async function DELETE(request: NextRequest) {
  if (!isAuthenticated(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });
  const stock = await load();
  await getKvClient().set(STOCK_KEY, stock.filter((s) => s.id !== id));
  return NextResponse.json({ success: true });
}
