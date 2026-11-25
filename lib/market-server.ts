import { getKvClient } from "@/lib/kv";
import { catalogData } from "@/lib/db";
import { loadMarketRows } from "@/lib/market-db";
import { DEMAND_KEY, Demand, OurPrice, Product, marketReport } from "@/lib/market";

// Everything marketReport() needs, loaded once per request.
export async function nzdPerCny(): Promise<number | null> {
  try {   // ECB reference rates (no key), cached for a day
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=NZD&symbols=CNY", { next: { revalidate: 86400 } });
    const d = await r.json();
    return d?.rates?.CNY ? 1 / d.rates.CNY : null;
  } catch {
    return null;
  }
}

// CNY per NZD on a sale's day (ECB reference rate; a weekend gives the last weekday's), the same rate dt orders fill uses.
export async function cnyPerNzdOn(day: string): Promise<number | null> {
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/${day.slice(0, 10)}?base=NZD&symbols=CNY`, { next: { revalidate: 86400 } });
    const cny = (await r.json())?.rates?.CNY;
    return cny ? Math.round(cny * 10000) / 10000 : null;
  } catch {
    return null;
  }
}

export async function loadProducts(): Promise<Product[]> {
  const res = await fetch("https://www.driftae.com/products.json", { next: { revalidate: 600 } });
  if (!res.ok) throw new Error("CATALOGUE_UNAVAILABLE");
  return ((await res.json()).products ?? []) as Product[];
}

export async function loadMarketReport() {
  const [products, cat, rows, demand, cny] = await Promise.all([
    loadProducts(), catalogData(), loadMarketRows(), getKvClient().get<Demand>(DEMAND_KEY), nzdPerCny(),
  ]);
  const ours: Record<string, OurPrice> = {};
  for (const s of cat.status) if (s.tm_price) ours[s.product_id] = { price: Number(s.tm_price), from: "trademe" };
  for (const p of cat.prices) if (p.price != null) ours[p.product_id] = { price: Number(p.price), from: "catalog" };
  // a range counts at its high end, so margins are never overstated
  const costs: Record<string, number> = {};
  const costRanges: Record<string, [number, number]> = {};
  for (const c of cat.costs) {
    if (c.cost_cny == null) continue;
    costs[c.product_id] = Number(c.cost_cny_max ?? c.cost_cny);
    if (c.cost_cny_max != null) costRanges[c.product_id] = [Number(c.cost_cny), Number(c.cost_cny_max)];
  }
  return marketReport({ products, ours, ...rows, demand: demand ?? null, nzdPerCny: cny, costs, costRanges });
}
