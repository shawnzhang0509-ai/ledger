import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { Order, calculateGrossProfit, getPurchaseCostNzd, normalizeOrderInput } from "@/lib/data";
import { STOCK_KEY, StockItem, cleanStockFields, nzDate, normalizeStock } from "@/lib/stock";
import { pushTokenMatches } from "@/lib/session";

// The team's WeChat bots (driftae-ops `dt stock …`, Bearer METRICS_PUSH_TOKEN) keep the stock here, with the
// same rules as /api/orders/bot: add a car, fill a field that is still empty, never change a value a person
// entered, never delete. Two actions move a cost between stock and the books so it is counted only once:
//   sell:   the car's costs go into the sale row's empty cost fields; the car becomes Sold, linked to the sale.
//   return: the car comes back; the purchase cost it still has goes back to stock, what can't be recovered
//           (air freight, return courier, any loss on the car) stays on the sale row as the sale's loss.
// The refunded price/shipping of a returned sale is changed by a person on the 订单 page, not here.

const ORDERS_KEY = "diecast:orders";
const empty = (v: unknown) => v == null || v === "" || v === 0;
const r2 = (n: number) => Math.round(n * 100) / 100;
const stamp = (by: string, what: string) => `[bot ${new Date().toISOString().slice(0, 10)} ${by}] ${what}`.slice(0, 300);
const addNote = (notes: string, ...more: string[]) => [notes, ...more].filter(Boolean).join(" ").slice(-2000);
const COSTS = ["purchaseCostCny", "exchangeRate", "purchaseCost", "airFreight", "courierCost"] as const;

type Body = {
  action?: string; id?: string; orderId?: string; by?: string; note?: string; fields?: Record<string, unknown>;
  keep?: number; lossAir?: number; lossCourier?: number;
};

const bad = (error: string, status = 400, extra: object = {}) => NextResponse.json({ error, ...extra }, { status });

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) return bad("Unauthorized", 401);
  let body: Body;
  try {
    body = await request.json();
  } catch {
    return bad("Bad body");
  }
  const action = body.action ?? "";
  if (!["add", "fill", "sell", "return"].includes(action)) return bad("Need action add|fill|sell|return");
  const by = String(body.by ?? "bot").trim().slice(0, 40);
  const note = String(body.note ?? "").trim().slice(0, 300);
  const fields = cleanStockFields(body.fields || {});
  const now = new Date().toISOString();

  const kv = getKvClient();
  const stock = ((await kv.get<StockItem[]>(STOCK_KEY)) || []).map(normalizeStock);
  const at = body.id ? stock.findIndex((s) => s.id === body.id) : -1;
  if (body.id && at < 0) return bad("No such stock item", 404, { id: body.id });

  if (action === "add") {
    if (!fields.model) return bad("Need fields.model");
    if (fields.status === "Sold") return bad("A new car can't be Sold: add it, then `sell` it to a sale");
    const item = normalizeStock({ location: "NZ", acquiredAt: nzDate(new Date()), ...fields, id: crypto.randomUUID(),
      notes: [stamp(by, "recorded"), note].filter(Boolean).join(" "), createdAt: now, updatedAt: now });
    stock.push(item);
    await kv.set(STOCK_KEY, stock);
    return NextResponse.json({ added: item.id, item }, { status: 201 });
  }

  if (action === "fill") {
    if (at < 0) return bad("Need id");
    const cur = stock[at] as StockItem & Record<string, unknown>;
    const filled: string[] = [];
    const kept: { field: string; recorded: unknown; offered: unknown }[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (k === "status" || k === "location") {
        // where the car is and whether it's listed are its state, not a recorded value; Sold only via sell/return
        if (v === "Sold" || cur.status === "Sold") { if (v !== cur[k]) kept.push({ field: k, recorded: cur[k], offered: v }); }
        else if (v !== cur[k]) { cur[k] = v; filled.push(k); }
      } else if (empty(cur[k])) {
        cur[k] = v; filled.push(k);
      } else if (cur[k] !== v) {
        kept.push({ field: k, recorded: cur[k], offered: v });
      }
    }
    if (filled.length || note) {
      stock[at] = normalizeStock({ ...cur, updatedAt: now,
        notes: addNote(cur.notes, stamp(by, filled.length ? `filled ${filled.join(", ")}` : "note"), note) });
      await kv.set(STOCK_KEY, stock);
    }
    return NextResponse.json({ id: cur.id, filled, kept_existing: kept, item: stock[at] });
  }

  const orderId = String(body.orderId ?? "").trim().slice(0, 40);
  if (!orderId) return bad("Need orderId");
  const orders = ((await kv.get<Order[]>(ORDERS_KEY)) || []).map((o) => normalizeOrderInput(o));
  const oi = orders.findIndex((o) => o.orderId === orderId);
  if (oi < 0) return bad("No such order", 404, { orderId });
  const order = orders[oi] as Order & Record<string, unknown>;
  const saveOrder = (what: string) => {
    const n = normalizeOrderInput(order);
    orders[oi] = { ...n, grossProfit: calculateGrossProfit(n), updatedAt: now, notes: addNote(order.notes, stamp(by, what), note) };
  };

  if (action === "sell") {
    if (at < 0) return bad("Need id");
    const item = stock[at];
    if (item.status === "Sold") return bad("Already sold", 409, { id: item.id, orderId: item.orderId });
    const other = stock.find((s) => s.orderId === orderId && s.status === "Sold");
    if (other) return bad("That sale already has a car from stock", 409, { id: other.id });
    const filled: string[] = [];
    const kept: { field: string; recorded: unknown; offered: unknown }[] = [];
    for (const k of COSTS) {
      if (empty(item[k])) continue;
      if (empty(order[k])) { order[k] = item[k]; filled.push(k); }
      else if (order[k] !== item[k]) kept.push({ field: k, recorded: order[k], offered: item[k] });
    }
    saveOrder(`from stock #${item.id.slice(0, 8)}${filled.length ? `: filled ${filled.join(", ")}` : ""}`);
    stock[at] = normalizeStock({ ...item, status: "Sold", orderId, soldAt: order.dateSold || nzDate(new Date()), updatedAt: now,
      notes: addNote(item.notes, stamp(by, `sold → ${orderId}`), note) });
    await kv.set(ORDERS_KEY, orders);
    await kv.set(STOCK_KEY, stock);
    return NextResponse.json({ id: item.id, orderId, filled, kept_existing: kept, item: stock[at],
      grossProfit: orders[oi].grossProfit });
  }

  // return
  if (stock.some((s) => s.returnedFrom === orderId && s.status !== "Sold"))
    return bad("Already returned to stock", 409, { orderId });
  const ai = at >= 0 ? at : stock.findIndex((s) => s.orderId === orderId && s.status === "Sold");
  if (ai >= 0 && stock[ai].orderId !== orderId) return bad("That car was not sold to this sale", 409, { id: stock[ai].id });
  const purchase = getPurchaseCostNzd(order);
  const keep = body.keep == null ? purchase : r2(Number(body.keep));
  if (!Number.isFinite(keep) || keep < 0 || keep > purchase + 0.005)
    return bad(`keep must be between 0 and the sale's purchase cost $${purchase}`, 400, { purchase });
  const filled: string[] = [];
  const kept: { field: string; recorded: unknown; offered: unknown }[] = [];
  for (const [k, v] of [["airFreight", body.lossAir], ["courierCost", body.lossCourier]] as const) {
    if (v == null) continue;
    const n = r2(Number(v));
    if (!Number.isFinite(n) || n < 0) return bad(`${k} must be a number ≥ 0`);
    if (empty(order[k])) { order[k] = n; filled.push(k); }
    else if (order[k] !== n) kept.push({ field: k, recorded: order[k], offered: n });
  }
  // the purchase cost moves: whole (CNY + rate travel with it) or the kept part in NZD
  const whole = Math.abs(keep - purchase) < 0.005;
  const costs = whole
    ? { purchaseCostCny: order.purchaseCostCny, exchangeRate: order.exchangeRate, purchaseCost: purchase }
    : { purchaseCostCny: 0, exchangeRate: 0, purchaseCost: keep };
  Object.assign(order, { purchaseCostCny: 0, exchangeRate: 0, purchaseCost: r2(purchase - keep) });
  saveOrder(`returned: $${keep} purchase cost back to stock${filled.length ? `; filled ${filled.join(", ")}` : ""}`);
  const base = ai >= 0 ? stock[ai] : normalizeStock({ id: crypto.randomUUID(), model: order.model, brand: order.brand,
    scale: order.scale, createdAt: now, notes: stamp(by, `recorded from returned sale ${orderId}`) });
  const item = normalizeStock({ ...base, ...costs, airFreight: 0, courierCost: 0, status: "InStock", location: "NZ",
    orderId: "", soldAt: "", returnedFrom: orderId, updatedAt: now,
    notes: addNote(base.notes, stamp(by, `returned from ${orderId}; its air freight and courier stay on that sale as the loss`), note) });
  if (ai >= 0) stock[ai] = item; else stock.push(item);
  await kv.set(ORDERS_KEY, orders);
  await kv.set(STOCK_KEY, stock);
  return NextResponse.json({ id: item.id, orderId, kept_cost: keep, sale_loss_purchase: r2(purchase - keep), filled,
    kept_existing: kept, item, grossProfit: orders[oi].grossProfit,
    next: "a person sets the refunded price and shipping on the 订单 page (bots don't change entered values)" });
}
