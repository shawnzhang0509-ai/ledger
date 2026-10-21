import { calculatePurchaseCostNzd } from "@/lib/data";

// Stock: one row per car, from bought to sold. Its landed cost travels into the sale row when it sells
// (`sell`) and back when a sale is returned (`return`), so each cost is counted in exactly one place.
// The /stock page, the WeChat card (/api/stock/card) and the bots (`dt stock …`) all read stockReport().

export const STOCK_KEY = "diecast:stock";
export const STOCK_STATUS = ["InStock", "Listed", "InTransit", "Sold"] as const;
export type StockStatus = (typeof STOCK_STATUS)[number];
export const STOCK_LABELS: Record<StockStatus, string> = { InStock: "在库", Listed: "已上架", InTransit: "在途", Sold: "已售" };
export const LOCATIONS = ["NZ", "China", "In transit"] as const;
const OLD_DAYS = 90;

export interface StockItem {
  id: string;
  model: string;
  brand: string;
  scale: string;
  ref: string;               // maker's reference, e.g. 182805
  purchaseCostCny: number;
  exchangeRate: number;      // 1 NZD = ? CNY
  purchaseCost: number;      // NZD: from CNY ÷ rate when both are in
  airFreight: number;
  courierCost: number;
  landedCost: number;        // derived: purchaseCost + airFreight + courierCost
  status: StockStatus;
  location: string;
  acquiredAt: string;        // YYYY-MM-DD
  listingId: string;         // Trade Me
  orderId: string;           // the sale it went to (KP-…)
  soldAt: string;            // YYYY-MM-DD
  returnedFrom: string;      // the sale it came back from, whose loss stays on that sale row
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export const MONEY = ["purchaseCostCny", "exchangeRate", "purchaseCost", "airFreight", "courierCost"] as const;
export const TEXT = ["model", "brand", "scale", "ref", "location", "acquiredAt", "listingId"] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Fills defaults and derives purchaseCost (from CNY when both are in) and landedCost. */
export function normalizeStock(input: Partial<StockItem>): StockItem {
  const num = (k: (typeof MONEY)[number]) => (Number.isFinite(Number(input[k])) ? Number(input[k]) : 0);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const fromCny = calculatePurchaseCostNzd(num("purchaseCostCny"), num("exchangeRate"));
  const purchaseCost = fromCny > 0 ? fromCny : num("purchaseCost");
  const status = STOCK_STATUS.includes(input.status as StockStatus) ? (input.status as StockStatus) : "InStock";
  return {
    id: str(input.id), model: str(input.model), brand: str(input.brand), scale: str(input.scale), ref: str(input.ref),
    purchaseCostCny: num("purchaseCostCny"), exchangeRate: num("exchangeRate"), purchaseCost,
    airFreight: num("airFreight"), courierCost: num("courierCost"),
    landedCost: r2(purchaseCost + num("airFreight") + num("courierCost")),
    status, location: str(input.location), acquiredAt: str(input.acquiredAt), listingId: str(input.listingId),
    orderId: str(input.orderId), soldAt: str(input.soldAt), returnedFrom: str(input.returnedFrom),
    notes: str(input.notes), createdAt: str(input.createdAt), updatedAt: str(input.updatedAt),
  };
}

/** Bot/page input → only known fields, money as 2-decimal numbers in range, text trimmed. */
export function cleanStockFields(raw: Record<string, unknown>) {
  const out: Partial<Record<(typeof MONEY)[number], number> & Record<(typeof TEXT)[number], string>> & { status?: StockStatus } = {};
  for (const k of MONEY) {
    const v = Number(raw[k]);
    if (raw[k] != null && raw[k] !== "" && Number.isFinite(v) && v >= 0 && v < 100000) out[k] = r2(v);
  }
  for (const k of TEXT) if (typeof raw[k] === "string" && raw[k]) out[k] = String(raw[k]).trim().slice(0, 200);
  if (typeof raw.status === "string" && STOCK_STATUS.includes(raw.status as StockStatus)) out.status = raw.status as StockStatus;
  return out;
}

export type StockLine = StockItem & { missing: string[]; flags: string[]; days: number | null };
export type StockReport = {
  asOf: string;
  items: StockLine[];
  totals: {
    inStock: number;           // not sold yet: in stock, listed or in transit
    stockCost: number;         // their landed cost together
    listed: number;
    soldThisMonth: number;
    byStatus: Record<StockStatus, { count: number; cost: number }>;
  };
  flags: { id: string; model: string; flag: string }[];
};

export const nzDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" });

export function stockReport(raw: Partial<StockItem>[], now = new Date()): StockReport {
  const today = nzDate(now);
  const items = raw.map(normalizeStock);
  const unsold = items.filter((i) => i.status !== "Sold");
  const refs = new Map<string, number>();
  for (const i of unsold) if (i.ref) refs.set(i.ref, (refs.get(i.ref) || 0) + 1);

  const lines: StockLine[] = items.map((i) => {
    const missing: string[] = [];
    if (!i.purchaseCost) missing.push(i.purchaseCostCny && !i.exchangeRate ? "汇率" : "进货价");
    if (!i.ref) missing.push("货号");
    const days = i.acquiredAt ? Math.floor((Date.parse(today) - Date.parse(i.acquiredAt)) / 86400000) : null;
    const flags: string[] = [];
    if (!i.landedCost) flags.push("落地成本是 0");
    if (i.status === "Sold" && !i.orderId) flags.push("已售但没挂销售单");
    if (i.status !== "Sold" && i.ref && (refs.get(i.ref) || 0) > 1) flags.push(`货号 ${i.ref} 在库登记了 ${refs.get(i.ref)} 次：是重复登记还是真有几台？`);
    if (i.status !== "Sold" && days != null && days > OLD_DAYS) flags.push(`在库 ${days} 天，超过 ${OLD_DAYS} 天`);
    return { ...i, missing, flags, days };
  }).sort((a, b) => Number(a.status === "Sold") - Number(b.status === "Sold") || (b.acquiredAt || b.createdAt).localeCompare(a.acquiredAt || a.createdAt));

  const byStatus = Object.fromEntries(STOCK_STATUS.map((s) => {
    const of = items.filter((i) => i.status === s);
    return [s, { count: of.length, cost: r2(of.reduce((n, i) => n + i.landedCost, 0)) }];
  })) as StockReport["totals"]["byStatus"];

  return {
    asOf: now.toISOString(),
    items: lines,
    totals: {
      inStock: unsold.length,
      stockCost: r2(unsold.reduce((n, i) => n + i.landedCost, 0)),
      listed: byStatus.Listed.count,
      soldThisMonth: items.filter((i) => i.status === "Sold" && i.soldAt.slice(0, 7) === today.slice(0, 7)).length,
      byStatus,
    },
    flags: lines.flatMap((l) => l.flags.map((flag) => ({ id: l.id, model: l.model, flag }))),
  };
}
