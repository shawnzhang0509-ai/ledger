// The market report: what the same car costs elsewhere (Bay Hobbies first: the NZ shop the team prices against),
// which cars still need their maker ref (货号), and the 新品雷达 candidates. Computed here from the market records
// (lib/market-db.ts), the team's prices (/catalog) and the storefront catalogue; the page /market, the card and the
// bots (`dt market report`) all read marketReport(), so they never disagree.
import type { PriceRow, RadarRow, RefRow, SeenRow } from "@/lib/market-db";

export const DEMAND_KEY = "ops:market-demand";   // demand per car family: pushed by `dt market push` (server-side sources)
export const FREIGHT_EST_NZD = 30;                // air freight + courier per car, a first guess for radar margins
export const STALE_DAYS = 60;                     // a recorded price older than this no longer counts

export type Product = { id: string; name: string; brand?: string; image?: string };
export type OurPrice = { price: number; from: "catalog" | "trademe" };

export type MarketFamily = { family: string; label: string; products: number; tm_views: number; tm_watchers: number;
  sold: number; site_visitors: number; messenger_starts: number; ad_conversations: number; ad_spend: number;
  watch_rate_pct: number | null; sold_per_product: number | null; cost_per_conversation: number | null };
export type MarketDemandProduct = { product: string; name: string; family: string; tm_views: number; tm_watchers: number;
  sold: number; site_visitors: number; messenger_starts: number; ad_conversations: number };
export type Demand = { built: string; days: number; sales_days: number; families: MarketFamily[]; products: MarketDemandProduct[] };

export type Other = { kind: "trademe" | "recorded"; id: string; source: string; total_nzd: number; shipping_known: boolean;
  checked: boolean; url: string; title: string | null };
export type PriceLine = {
  product: string; name: string; ref: string | null; ref_status: RefRow["status"]; colour: string | null;
  our_price: number | null; our_price_from: OurPrice["from"] | null; goods_cost_nzd: number | null;
  bayhobbies: { price: number; match: "ref" | "model"; title: string; url: string | null } | null;
  vs_bayhobbies_pct: number | null;        // > 0: we are dearer than Bay Hobbies
  others: Other[];                         // other Trade Me sellers + prices people or bots recorded
};
export type RadarLine = RadarRow & { family_label: string; family_sold_per_product: number | null;
  family_watch_rate_pct: number | null; family_our_median_price: number | null; landed_est_nzd: number | null;
  margin_est_nzd: number | null };
export type MarketReport = {
  built: string; bayhobbies_seen: string | null; trademe_seen: string | null;
  refs: Record<RefRow["status"], number>;
  products: PriceLine[];
  missing_refs: { product: string; name: string; status: RefRow["status"]; ref: string | null; note: string | null; sources: string[] }[];
  unchecked_prices: { id: string; product: string; name: string; source: string; total_nzd: number; url: string }[];
  radar: RadarLine[];
  demand: Demand | null;
  freight_est_nzd: number;
};

export const REF_LABELS: Record<RefRow["status"], string> = { confirmed: "已确认", candidate: "待核对", unknown: "未知" };
export const RADAR_LABELS: Record<RadarRow["status"], string> = { proposed: "待定", kept: "要", dropped: "不要" };

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const pct = (ours: number | null, theirs: number | null) => (ours && theirs ? Math.round(((ours - theirs) / theirs) * 100) : null);

export function marketReport(input: {
  products: Product[]; ours: Record<string, OurPrice>; refs: RefRow[]; prices: PriceRow[]; seen: SeenRow[];
  radar: RadarRow[]; demand: Demand | null; nzdPerCny: number | null; now?: Date;
}): MarketReport {
  const now = input.now ?? new Date();
  const refOf = new Map(input.refs.map((r) => [r.product_id, r]));
  const cutoff = new Date(now.getTime() - STALE_DAYS * 86400000).toISOString().slice(0, 16);
  const names = new Map(input.products.map((p) => [p.id, p.name]));

  const products: PriceLine[] = input.products.map((p): PriceLine => {
    const r = refOf.get(p.id);
    const our = input.ours[p.id] ?? null;
    let image = p.image ?? "";
    try { image = decodeURIComponent(image); } catch { /* keep as is */ }
    const rmb = image.match(/RMB\s*(\d+)/i);
    const bh = input.seen.filter((s) => s.source === "bayhobbies" && s.product_id === p.id && s.price_nzd != null)
      .sort((a, b) => Number(b.match === "ref") - Number(a.match === "ref") || (a.price_nzd ?? 0) - (b.price_nzd ?? 0))[0];
    const others: Other[] = [
      ...input.seen.filter((s) => s.source === "trademe" && s.product_id === p.id && s.price_nzd != null).map((s): Other => ({
        kind: "trademe", id: s.key, source: "Trade Me", total_nzd: s.price_nzd as number, shipping_known: true,
        checked: s.match === "ref", url: s.url ?? `https://www.trademe.co.nz/a/${s.key}`, title: s.title })),
      ...input.prices.filter((o) => o.product_id === p.id && o.status !== "rejected" && o.at >= cutoff).map((o): Other => ({
        kind: "recorded", id: o.id, source: o.source, total_nzd: o.total_nzd, shipping_known: o.shipping_known,
        checked: o.status === "confirmed", url: o.url, title: null })),
    ].sort((a, b) => a.total_nzd - b.total_nzd);
    return {
      product: p.id, name: p.name, ref: r?.ref ?? null, ref_status: r?.status ?? "unknown", colour: r?.colour ?? null,
      our_price: our?.price ?? null, our_price_from: our?.from ?? null,
      goods_cost_nzd: rmb && input.nzdPerCny ? Math.round(Number(rmb[1]) * input.nzdPerCny) : null,
      bayhobbies: bh ? { price: bh.price_nzd as number, match: bh.match === "ref" ? "ref" : "model", title: bh.title, url: bh.url } : null,
      vs_bayhobbies_pct: pct(our?.price ?? null, bh?.price_nzd ?? null),
      others,
    };
  }).sort((a, b) => Number(!a.bayhobbies) - Number(!b.bayhobbies) || (b.vs_bayhobbies_pct ?? -999) - (a.vs_bayhobbies_pct ?? -999)
    || Number(!a.others.length) - Number(!b.others.length));

  const fam = new Map((input.demand?.families ?? []).map((f) => [f.family, f]));
  const famOf = new Map((input.demand?.products ?? []).map((p) => [p.product, p.family]));
  const famPrices = new Map<string, number[]>();
  for (const [id, o] of Object.entries(input.ours)) {
    const f = famOf.get(id);
    if (f) famPrices.set(f, [...(famPrices.get(f) ?? []), o.price]);
  }
  const radar: RadarLine[] = input.radar.map((c): RadarLine => {
    const f = fam.get(c.family);
    const nz = median(famPrices.get(c.family) ?? []);
    const landed = c.supplier_cny != null && input.nzdPerCny ? Math.round(c.supplier_cny * input.nzdPerCny + FREIGHT_EST_NZD) : null;
    return { ...c, family_label: f?.label ?? c.family, family_sold_per_product: f?.sold_per_product ?? null,
      family_watch_rate_pct: f?.watch_rate_pct ?? null, family_our_median_price: nz, landed_est_nzd: landed,
      margin_est_nzd: nz != null && landed != null ? Math.round(nz - landed) : null };
  }).sort((a, b) => Number(a.status === "dropped") - Number(b.status === "dropped") || Number(b.status === "kept") - Number(a.status === "kept")
    || (b.family_sold_per_product ?? 0) - (a.family_sold_per_product ?? 0) || (b.family_watch_rate_pct ?? 0) - (a.family_watch_rate_pct ?? 0));

  const counts = { confirmed: 0, candidate: 0, unknown: 0 };
  for (const p of products) counts[p.ref_status] += 1;
  const latest = (src: string) => input.seen.filter((s) => s.source === src).map((s) => s.seen_at).sort().pop() ?? null;
  return {
    built: now.toISOString(), bayhobbies_seen: latest("bayhobbies"), trademe_seen: latest("trademe"),
    refs: counts, products,
    missing_refs: products.filter((p) => p.ref_status !== "confirmed").map((p): MarketReport["missing_refs"][number] => {
      const r = refOf.get(p.product);
      return { product: p.product, name: p.name, status: p.ref_status, ref: p.ref, note: r?.note ?? null, sources: r?.sources ?? [] };
    }).sort((a, b) => Number(a.status === "candidate") - Number(b.status === "candidate")),
    unchecked_prices: input.prices.filter((o) => o.status === "proposed" && o.at >= cutoff)
      .map((o) => ({ id: o.id, product: o.product_id, name: names.get(o.product_id) ?? o.product_id, source: o.source, total_nzd: o.total_nzd, url: o.url })),
    radar, demand: input.demand, freight_est_nzd: FREIGHT_EST_NZD,
  };
}
