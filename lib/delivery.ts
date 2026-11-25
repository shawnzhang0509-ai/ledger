import { Order } from "@/lib/data";

// What the product description promises ("approximately 2 weeks") and the red line (wife 2026-11-25).
export const PROMISED_DAYS = 14;
export const SLOW_DAYS = 21;

export interface CycleStat { n: number; avg: number; median: number; max: number }
export interface CycleRow { orderId: string; toShip: number | null; toDeliver: number | null }

const DAY = /^\d{4}-\d{2}-\d{2}/;
function gap(from?: string, to?: string): number | null {
  if (!from || !to || !DAY.test(from) || !DAY.test(to)) return null;
  const d = (Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86400000;
  return Number.isFinite(d) && d >= 0 ? d : null;   // missing or impossible dates stay blank
}

function stat(v: number[]): CycleStat | null {
  if (!v.length) return null;
  const s = [...v].sort((a, b) => a - b), m = s.length >> 1;
  return { n: s.length, avg: s.reduce((a, b) => a + b, 0) / s.length,
    median: s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2, max: s[s.length - 1] };
}

/** 成交→发货 and 成交→送达 per order; only orders with the dates count, nothing is guessed. */
export function deliveryCycle(orders: Order[]) {
  const live = orders.filter((o) => o.status !== "Cancelled");
  const rows: CycleRow[] = live
    .map((o) => ({ orderId: o.orderId, toShip: gap(o.dateSold, o.shippedDate), toDeliver: gap(o.dateSold, o.deliveredDate) }))
    .filter((r) => r.toShip != null || r.toDeliver != null);
  return {
    rows,
    total: live.length,
    ship: stat(rows.flatMap((r) => (r.toShip == null ? [] : [r.toShip]))),
    deliver: stat(rows.flatMap((r) => (r.toDeliver == null ? [] : [r.toDeliver]))),
    slow: rows.filter((r) => (r.toDeliver ?? 0) > SLOW_DAYS),
  };
}
