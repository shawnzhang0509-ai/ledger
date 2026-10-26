import { Order, getPurchaseCostNzd } from "@/lib/data";
import type { StockItem } from "@/lib/stock";

// One place for what the books say: each sale's cost breakdown, which costs are still missing, and the
// numbers that look wrong. The /books page, the WeChat card (/api/orders/card) and the bots
// (`dt orders report|gaps`) all read this, so nobody redraws or re-derives it by hand.

export const COST_LABELS = { purchase: "进货价", rate: "汇率", air: "空运费", courier: "快递成本" } as const;

export type BookLine = {
  orderId: string; dateSold: string; model: string; status: Order["status"];
  price: number; shipping: number; fee: number; purchase: number; air: number; courier: number; gp: number;
  complete: boolean;        // every cost is in, so gp is a real profit
  missing: string[];        // labels of the costs still blank
  flags: string[];          // numbers a person should check on the order page
  airDoor: boolean;         // air freight door to door: a 0 courier cost is real, not missing
  stockId: string | null;   // the stock row this sale came from (or went back to, when returned)
  returned: boolean;        // the car came back: its purchase cost is on the stock row, the loss stays here
};
export type Split = { purchase: number; air: number; courier: number; fee: number; gp: number };
export type BooksReport = {
  asOf: string;
  lines: BookLine[];
  totals: {
    orders: number; complete: number; revenue: number; fee: number;
    // only orders whose costs are all in: the real profit so far
    completeRevenue: number; completeGp: number; marginPct: number | null; split: Split | null;
  };
  months: { month: string; orders: number; revenue: number; complete: number; completeGp: number }[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const PENDING_DAYS = 7;

function line(o: Order, today: string, dupes: Set<string>, stock: StockItem[]): BookLine {
  const back = stock.find((s) => s.returnedFrom === o.orderId);
  const from = stock.find((s) => s.orderId === o.orderId) || back;
  const returned = !!back;
  const price = o.sellingPrice || 0, shipping = o.shippingCharge || 0, fee = o.tradeMeFee || 0;
  const purchase = getPurchaseCostNzd(o), air = o.airFreight || 0, courier = o.courierCost || 0;
  const missing: string[] = [];
  if (!purchase && !returned) {
    if (!o.purchaseCostCny) missing.push(COST_LABELS.purchase);
    if (!o.exchangeRate) missing.push(COST_LABELS.rate);
  }
  if (!air) missing.push(COST_LABELS.air);
  // Our air freight goes door to door (owner 2026-10-21: "这些空运全是直接 door to door"), so a sale with air freight and no
  // courier cost is door to door unless someone marked it "courier". Only then, or with no air freight (sold from NZ
  // stock), is a 0 courier cost a blank to fill.
  const airDoor = o.deliveryMode === "air-door" || (o.deliveryMode !== "courier" && air > 0 && !courier);
  if (!courier && !airDoor) missing.push(COST_LABELS.courier);   // door-to-door air: no courier cost, not a blank
  const complete = missing.length === 0;
  const gp = r2(price + shipping - purchase - air - fee - courier);

  const flags: string[] = [];
  if (dupes.has(o.orderId)) flags.push(`订单号 ${o.orderId} 记了不止一次`);
  if (!price && !returned) flags.push("售价是 0");
  else if (price && (price < 50 || price > 2000)) flags.push(`售价 $${price} 不在 $50–$2000 之间`);
  if (price && Math.round(price) !== price && shipping)
    flags.push(`售价 $${price} 带零头且另记了运费 $${shipping}：可能把运费算进了售价，运费算了两次`);
  if (price && fee > 0.15 * price) flags.push(`Trade Me 费用 $${fee} 超过售价的 15%`);
  if (shipping && courier && courier - shipping > 5)
    flags.push(`快递成本 $${courier} 比收的运费 $${shipping} 高 $${r2(courier - shipping)}`);
  if (complete && gp < 0 && !returned) flags.push(`毛利是负的（$${gp}）`);
  else if (complete && price && gp > 0.6 * price) flags.push(`毛利 $${gp} 超过售价的 60%，成本可能少记了`);
  if ((o.status === "Shipped" || o.status === "Completed") && !o.tracking) flags.push("已发货但没有物流单号");
  if (o.status === "Pending" && !returned && o.dateSold && daysBetween(o.dateSold, today) > PENDING_DAYS)
    flags.push(`待处理已超过 ${PENDING_DAYS} 天：客人付款了吗？`);

  return { orderId: o.orderId, dateSold: o.dateSold, model: (o.model || "").trim(), status: o.status,
    price, shipping, fee, purchase, air, courier, gp, complete, missing, flags, airDoor, stockId: from?.id || null, returned };
}

function daysBetween(a: string, b: string) {
  return (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 86400000;
}

export function booksReport(orders: Order[], now = new Date(), stock: StockItem[] = []): BooksReport {
  const today = now.toISOString().slice(0, 10);
  const seen = new Set<string>(), dupes = new Set<string>();
  for (const o of orders) (seen.has(o.orderId) ? dupes : seen).add(o.orderId);
  const lines = orders
    .filter((o) => o.status !== "Cancelled")
    .map((o) => line(o, today, dupes, stock))
    .sort((a, b) => (b.dateSold || "").localeCompare(a.dateSold || ""));

  const sum = (ls: BookLine[], f: (l: BookLine) => number) => r2(ls.reduce((s, l) => s + f(l), 0));
  const done = lines.filter((l) => l.complete);
  const completeRevenue = sum(done, (l) => l.price + l.shipping);
  const completeGp = sum(done, (l) => l.gp);
  const share = (n: number) => (completeRevenue ? r2((n / completeRevenue) * 100) : 0);
  const split = completeRevenue
    ? { purchase: share(sum(done, (l) => l.purchase)), air: share(sum(done, (l) => l.air)),
        courier: share(sum(done, (l) => l.courier)), fee: share(sum(done, (l) => l.fee)), gp: share(completeGp) }
    : null;

  const byMonth = new Map<string, BookLine[]>();
  for (const l of lines) {
    const m = (l.dateSold || "").slice(0, 7) || "unknown";
    byMonth.set(m, [...(byMonth.get(m) || []), l]);
  }
  const months = Array.from(byMonth, ([month, ls]) => {
    const c = ls.filter((l) => l.complete);
    return { month, orders: ls.length, revenue: sum(ls, (l) => l.price + l.shipping), complete: c.length,
      completeGp: sum(c, (l) => l.gp) };
  }).sort((a, b) => b.month.localeCompare(a.month));

  return {
    asOf: now.toISOString(),
    lines,
    totals: { orders: lines.length, complete: done.length, revenue: sum(lines, (l) => l.price + l.shipping),
      fee: sum(lines, (l) => l.fee), completeRevenue, completeGp,
      marginPct: completeRevenue ? r2((completeGp / completeRevenue) * 100) : null, split },
    months,
  };
}
