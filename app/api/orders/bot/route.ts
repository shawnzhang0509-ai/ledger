import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { DELIVERY_MODES, DeliveryMode, Order, STATUS_OPTIONS, calculateGrossProfit, normalizeOrderInput } from "@/lib/data";
import { pushTokenMatches } from "@/lib/session";

// The team's WeChat bots (driftae-ops `dt orders …`, Bearer METRICS_PUSH_TOKEN) keep the books here.
// They can add a sale that isn't recorded yet, or fill in a field that is still empty. A value someone
// already entered is never changed and nothing is deleted: corrections are made by a person on the page.
// Every bot write is noted on the order (who, when, what) so it can be checked.

const ORDERS_KEY = "diecast:orders";
const MONEY = ["purchaseCostCny", "exchangeRate", "purchaseCost", "airFreight", "tradeMeFee",
  "shippingCharge", "courierCost", "sellingPrice"] as const;
const TEXT = ["dateSold", "customer", "model", "brand", "scale", "tracking"] as const;
// Pending < Paid < Shipped < Completed: a bot may only move an order forward, never cancel or reopen it.
const STATUS_RANK: Record<string, number> = { Pending: 0, Paid: 1, Shipped: 2, Completed: 3 };

type Fields = Partial<Record<(typeof MONEY)[number], number> & Record<(typeof TEXT)[number], string>> & {
  status?: Order["status"];
  deliveryMode?: DeliveryMode;   // filled only while blank, like every other field
};

function clean(raw: Record<string, unknown>): Fields {
  const out: Record<string, unknown> = {};
  for (const k of MONEY) {
    const v = Number(raw[k]);
    if (raw[k] != null && Number.isFinite(v) && v >= 0 && v < 100000) out[k] = Math.round(v * 100) / 100;
  }
  for (const k of TEXT) if (typeof raw[k] === "string" && raw[k]) out[k] = String(raw[k]).trim().slice(0, 200);
  if (typeof raw.status === "string" && raw.status in STATUS_RANK) out.status = raw.status;
  if (DELIVERY_MODES.includes(raw.deliveryMode as DeliveryMode)) out.deliveryMode = raw.deliveryMode;
  return out as Fields;
}

const empty = (v: unknown) => v == null || v === "" || v === 0;
const stamp = (by: string, what: string) =>
  `[bot ${new Date().toISOString().slice(0, 10)} ${by}] ${what}`.slice(0, 300);

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { action?: string; orderId?: string; by?: string; note?: string; fields?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  const orderId = String(body.orderId ?? "").trim().slice(0, 40);
  const by = String(body.by ?? "bot").trim().slice(0, 40);
  if (!orderId || !body.fields || !["add", "fill"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "Need action add|fill, orderId and fields" }, { status: 400 });
  }
  const fields = clean(body.fields);
  const note = String(body.note ?? "").trim().slice(0, 300);

  const kv = getKvClient();
  const orders = ((await kv.get<Order[]>(ORDERS_KEY)) || []).map((o) => normalizeOrderInput(o));
  const at = orders.findIndex((o) => o.orderId === orderId);
  const now = new Date().toISOString();

  if (body.action === "add") {
    if (at >= 0) return NextResponse.json({ error: "Already recorded", orderId }, { status: 409 });
    const base = {
      orderId, dateSold: "", customer: "", model: "", brand: "", scale: "", status: "Pending" as Order["status"],
      purchaseCostCny: 0, exchangeRate: 0, purchaseCost: 0, airFreight: 0, tradeMeFee: 0, shippingCharge: 0,
      courierCost: 0, sellingPrice: 0, tracking: "", ...fields,
      notes: [stamp(by, "recorded"), note].filter(Boolean).join(" "),
    };
    const normalized = normalizeOrderInput(base);
    const order: Order = { ...normalized, id: crypto.randomUUID(), grossProfit: calculateGrossProfit(normalized),
      createdAt: now, updatedAt: now };
    orders.push(order);
    await kv.set(ORDERS_KEY, orders);
    return NextResponse.json({ added: orderId, filled: Object.keys(fields) }, { status: 201 });
  }

  if (at < 0) return NextResponse.json({ error: "No such order", orderId }, { status: 404 });
  const cur = orders[at] as Order & Record<string, unknown>;
  const filled: string[] = [];
  const kept: { field: string; recorded: unknown; offered: unknown }[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (k === "status") {
      const from = STATUS_RANK[cur.status], to = STATUS_RANK[v as string];
      if (from !== undefined && to > from) { cur.status = v as Order["status"]; filled.push(k); }
      else if (v !== cur.status) kept.push({ field: k, recorded: cur.status, offered: v });
    } else if (empty(cur[k])) {
      cur[k] = v; filled.push(k);
    } else if (cur[k] !== v) {
      kept.push({ field: k, recorded: cur[k], offered: v });
    }
  }
  if (filled.length || note) {
    const normalized = normalizeOrderInput(cur);
    orders[at] = { ...normalized, grossProfit: calculateGrossProfit(normalized), updatedAt: now,
      notes: [cur.notes, stamp(by, filled.length ? `filled ${filled.join(", ")}` : "note"), note].filter(Boolean).join(" ").slice(-2000) };
    await kv.set(ORDERS_KEY, orders);
  }
  return NextResponse.json({ orderId, filled, kept_existing: kept, statuses: STATUS_OPTIONS });
}
