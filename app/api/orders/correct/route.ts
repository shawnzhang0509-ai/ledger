import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { getKvClient } from "@/lib/kv";
import { Order, OrderChange, calculateGrossProfit, calculatePurchaseCostNzd, normalizeOrderInput } from "@/lib/data";
import { pushTokenMatches } from "@/lib/session";

// Corrections the team approved with a WeChat code (driftae-ops `dt orders correct`, owner 2026-10-21): the one bot
// path that may change a value already in the books. One order at a time, only the money fields below, always with a
// reason; the old values stay in the order's history and notes. Needs METRICS_PUSH_TOKEN and, as a second key the bots
// can't read, X-Correct-Key = ORDERS_CORRECT_KEY. /api/orders/bot (fill only blanks) is unchanged.

const ORDERS_KEY = "diecast:orders";
const FIELDS = ["sellingPrice", "shippingCharge", "tradeMeFee", "airFreight", "courierCost",
  "purchaseCostCny", "exchangeRate", "purchaseCost"] as const;
type Field = (typeof FIELDS)[number];

function keyMatches(given: string | null): boolean {
  const key = process.env.ORDERS_CORRECT_KEY;
  if (!key || !given) return false;
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(key));
}

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization")) || !keyMatches(request.headers.get("x-correct-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { orderId?: string; fields?: Record<string, unknown>; reason?: string; by?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const orderId = String(body.orderId ?? "").trim().slice(0, 40);
  const reason = String(body.reason ?? "").trim().slice(0, 200);
  const by = String(body.by ?? "").trim().slice(0, 40) || "bot";
  const raw = body.fields ?? {};
  const unknown = Object.keys(raw).filter((k) => !(FIELDS as readonly string[]).includes(k));
  if (!orderId || !reason || !Object.keys(raw).length || unknown.length) {
    return NextResponse.json({ error: "Need orderId, reason and fields from: " + FIELDS.join(", "), unknown }, { status: 400 });
  }
  const fields: Partial<Record<Field, number>> = {};
  for (const k of Object.keys(raw) as Field[]) {
    const v = Number(raw[k]);
    if (!Number.isFinite(v) || v < 0 || v >= 100000) {
      return NextResponse.json({ error: `${k} must be a number from 0 to 99999.99` }, { status: 400 });
    }
    fields[k] = Math.round(v * 100) / 100;
  }

  const kv = getKvClient();
  const orders = ((await kv.get<Order[]>(ORDERS_KEY)) || []).map((o) => normalizeOrderInput(o));
  const at = orders.findIndex((o) => o.orderId === orderId);
  if (at < 0) return NextResponse.json({ error: "No such order", orderId }, { status: 404 });
  const cur = orders[at];
  const next: Order = { ...cur, ...fields };
  const derived: string[] = [];
  // purchaseCost (NZD) follows ¥ ÷ rate; with ¥ 0 it would otherwise fall back to the old NZD figure.
  if (("purchaseCostCny" in fields || "exchangeRate" in fields) && !("purchaseCost" in fields)) {
    next.purchaseCost = calculatePurchaseCostNzd(next.purchaseCostCny, next.exchangeRate);
    derived.push("purchaseCost");
  }
  const changes: Record<string, [number, number]> = {};
  for (const k of FIELDS) if (cur[k] !== next[k]) changes[k] = [cur[k], next[k]];
  if (!Object.keys(changes).length) {
    return NextResponse.json({ orderId, changed: {}, note: "nothing differs from the books" });
  }
  const now = new Date().toISOString();
  const entry: OrderChange = { at: now, by, reason, changes, ...(derived.length ? { derived } : {}) };
  const what = Object.entries(changes).map(([k, [a, b]]) => `${k} ${a}→${b}`).join(", ");
  orders[at] = {
    ...next,
    grossProfit: calculateGrossProfit(next),
    updatedAt: now,
    history: [...(cur.history || []), entry].slice(-50),
    notes: [cur.notes, `[bot ${now.slice(0, 10)} ${by} 改数] ${what}（${reason}）`].filter(Boolean).join(" ").slice(-2000),
  };
  await kv.set(ORDERS_KEY, orders);
  return NextResponse.json({ orderId, changed: changes, derived, grossProfit: orders[at].grossProfit });
}
