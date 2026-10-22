import { getKvClient } from "@/lib/kv";
import { catalogData } from "@/lib/db";
import { loadMarketRows } from "@/lib/market-db";
import { DEMAND_KEY, Demand, OurPrice, Product, marketReport } from "@/lib/market";

// Everything marketReport() needs, loaded once per request.
async function nzdPerCny(): Promise<number | null> {
  try {   // ECB reference rates (no key), cached for a day
    const r = await fetch("https://api.frankfurter.dev/v1/latest?base=NZD&symbols=CNY", { next: { revalidate: 86400 } });
    const d = await r.json();
    return d?.rates?.CNY ? 1 / d.rates.CNY : null;
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
  return marketReport({ products, ours, ...rows, demand: demand ?? null, nzdPerCny: cny });
}
