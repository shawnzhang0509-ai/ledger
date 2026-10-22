// Market snapshot pushed by `dt market push` (driftae-ops, every 30 min with the ops metrics): same-car prices
// elsewhere, demand per car family, and the 新品雷达 candidates. The page /market and the card read the same object.
export const MARKET_KEY = "ops:market";

export type MarketPriceRow = {
  product: string;
  name: string;
  ref: string | null;
  ref_status: "confirmed" | "candidate" | "unknown";
  our_price: number | null;
  our_price_from: "catalog" | "trademe" | null;
  goods_cost_nzd: number | null;
  trademe_others: { listing_id: number; title: string; buy_now: number | null; start_price: number | null; is_new: boolean | null; match: string }[];
  elsewhere: { id: string; source: string; total_nzd: number; shipping_known: boolean; match: string; status: string; at: string; url: string }[];
  lowest_elsewhere_nzd: number | null;
  lowest_without_shipping: boolean;
  lowest_unchecked?: boolean; // the lowest price is a bot's find (or a Trade Me model-name match) nobody has checked yet
  median_elsewhere_nzd: number | null;
  ours_vs_lowest_pct: number | null;
};

export type MarketFamily = {
  family: string;
  label: string;
  products: number;
  tm_views: number;
  tm_watchers: number;
  sold: number;
  site_visitors: number;
  messenger_starts: number;
  ad_conversations: number;
  ad_spend: number;
  watch_rate_pct: number | null;
  sold_per_product: number | null;
  cost_per_conversation: number | null;
};

export type MarketDemandProduct = {
  product: string;
  name: string;
  family: string;
  tm_views: number;
  tm_watchers: number;
  sold: number;
  site_visitors: number;
  messenger_starts: number;
  ad_conversations: number;
};

export type RadarCandidate = {
  id: string;
  brand: string;
  ref: string;
  name: string;
  scale: string | null;
  colour: string | null;
  family: string;
  url: string;
  overseas_nzd: number | null;
  shipping_known: boolean;
  release: string | null;
  why: string | null;
  status: "proposed" | "kept" | "dropped";
  at: string;
  family_sold_per_product: number | null;
  family_watch_rate_pct: number | null;
  family_our_median_price: number | null;
  supplier_cny: number | null;
  landed_est_nzd: number | null;
  margin_est_nzd: number | null;
};

export type MarketSnapshot = {
  built: string;
  refs: { confirmed: number; candidate: number; unknown: number };
  stale_after_days: number;
  scan: string | null;
  prices: MarketPriceRow[];
  demand: { days: number; sales_days: number; families: MarketFamily[]; products: MarketDemandProduct[] };
  radar: RadarCandidate[];
  freight_est_nzd: number;
};

export const REF_LABELS: Record<MarketPriceRow["ref_status"], string> = { confirmed: "已确认", candidate: "待核对", unknown: "未知" };
export const RADAR_LABELS: Record<RadarCandidate["status"], string> = { proposed: "待定", kept: "要", dropped: "不要" };
