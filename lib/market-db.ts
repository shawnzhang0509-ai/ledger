import { neon } from "@neondatabase/serverless";

// The market records (Postgres): maker refs (货号), prices of the same car elsewhere, what other shops list
// (Bay Hobbies, other Trade Me sellers) and the 新品雷达 candidates. People change them on /market, the bots through
// /api/market/bot (driftae-ops `dt market …`); every change says who made it. Nothing here is computed: lib/market.ts
// turns these rows into the report the page, the card and the bots read.

function client() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  return neon(url);
}

let ready = false;

async function sql() {
  const q = client();
  if (ready) return q;
  // refs: one row per change, the latest per product is current (so the history of who said what stays)
  await q`CREATE TABLE IF NOT EXISTS market_refs (
    id bigserial PRIMARY KEY, product_id text NOT NULL, brand text, ref text, colour text,
    status text NOT NULL, confidence text, sources jsonb NOT NULL DEFAULT '[]', note text,
    by text NOT NULL, at timestamptz NOT NULL DEFAULT now())`;
  await q`CREATE TABLE IF NOT EXISTS market_prices (
    id text PRIMARY KEY, product_id text NOT NULL, ref text, source text NOT NULL, seller text, url text NOT NULL,
    price numeric(10,2), currency text NOT NULL, shipping numeric(10,2), nzd_per_unit double precision, fx_date text,
    total_nzd numeric(10,2) NOT NULL, shipping_known boolean NOT NULL, match text NOT NULL, condition text NOT NULL,
    note text, status text NOT NULL DEFAULT 'proposed', status_why text, status_by text, status_at timestamptz,
    by text NOT NULL, at timestamptz NOT NULL DEFAULT now())`;
  // what a shop lists now: each scan replaces that source's rows (gone = not in the latest scan)
  await q`CREATE TABLE IF NOT EXISTS market_seen (
    source text NOT NULL, key text NOT NULL, product_id text, match text, title text NOT NULL, ref text,
    price_nzd numeric(10,2), url text, seen_at timestamptz NOT NULL, PRIMARY KEY (source, key))`;
  await q`CREATE TABLE IF NOT EXISTS market_radar (
    id text PRIMARY KEY, brand text NOT NULL, ref text NOT NULL, name text NOT NULL, scale text, colour text,
    family text NOT NULL, url text NOT NULL, price numeric(10,2), currency text, shipping numeric(10,2),
    overseas_nzd numeric(10,2), shipping_known boolean NOT NULL DEFAULT false, release text, why text,
    supplier_cny numeric(10,2), supplier_url text, status text NOT NULL DEFAULT 'proposed', status_why text,
    status_by text, by text NOT NULL, at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`;
  ready = true;
  return q;
}

export type RefRow = { product_id: string; brand: string | null; ref: string | null; colour: string | null;
  status: "confirmed" | "candidate" | "unknown"; confidence: string | null; sources: string[]; note: string | null; by: string; at: string };
export type PriceRow = { id: string; product_id: string; ref: string | null; source: string; seller: string | null; url: string;
  price: number | null; currency: string; shipping: number | null; total_nzd: number; shipping_known: boolean; match: string;
  condition: string; note: string | null; status: "proposed" | "confirmed" | "rejected"; status_why: string | null;
  status_by: string | null; by: string; at: string };
export type SeenRow = { source: string; key: string; product_id: string | null; match: string | null; title: string;
  ref: string | null; price_nzd: number | null; url: string | null; seen_at: string };
export type RadarRow = { id: string; brand: string; ref: string; name: string; scale: string | null; colour: string | null;
  family: string; url: string; price: number | null; currency: string | null; overseas_nzd: number | null; shipping_known: boolean;
  release: string | null; why: string | null; supplier_cny: number | null; supplier_url: string | null;
  status: "proposed" | "kept" | "dropped"; status_why: string | null; status_by: string | null; by: string; at: string };

// ISO in UTC ("…Z"): sorts as text and every reader formats it for Auckland itself
const ts = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export async function loadMarketRows() {
  const q = await sql();
  const [refs, prices, seen, radar] = await Promise.all([
    q.query(`SELECT DISTINCT ON (product_id) product_id, brand, ref, colour, status, confidence, sources, note, by, ${ts("at")} AS at
       FROM market_refs ORDER BY product_id, id DESC`),
    q.query(`SELECT id, product_id, ref, source, seller, url, price::float AS price, currency, shipping::float AS shipping,
         total_nzd::float AS total_nzd, shipping_known, match, condition, note, status, status_why, status_by, by, ${ts("at")} AS at
       FROM market_prices ORDER BY at DESC`),
    q.query(`SELECT source, key, product_id, match, title, ref, price_nzd::float AS price_nzd, url, ${ts("seen_at")} AS seen_at
       FROM market_seen`),
    q.query(`SELECT id, brand, ref, name, scale, colour, family, url, price::float AS price, currency, overseas_nzd::float AS overseas_nzd,
         shipping_known, release, why, supplier_cny::float AS supplier_cny, supplier_url, status, status_why, status_by, by, ${ts("at")} AS at
       FROM market_radar ORDER BY at DESC`),
  ]);
  return { refs: refs as RefRow[], prices: prices as PriceRow[], seen: seen as SeenRow[], radar: radar as RadarRow[] };
}

export async function addRef(r: Omit<RefRow, "at">) {
  const q = await sql();
  await q`INSERT INTO market_refs (product_id, brand, ref, colour, status, confidence, sources, note, by)
          VALUES (${r.product_id}, ${r.brand}, ${r.ref}, ${r.colour}, ${r.status}, ${r.confidence}, ${JSON.stringify(r.sources)}::jsonb, ${r.note}, ${r.by})`;
}

export async function addPrice(p: Omit<PriceRow, "status" | "status_why" | "status_by" | "at"> & { nzd_per_unit: number | null; fx_date: string | null; at?: string }) {
  const q = await sql();
  await q`INSERT INTO market_prices (id, product_id, ref, source, seller, url, price, currency, shipping, nzd_per_unit, fx_date,
            total_nzd, shipping_known, match, condition, note, by, at)
          VALUES (${p.id}, ${p.product_id}, ${p.ref}, ${p.source}, ${p.seller}, ${p.url}, ${p.price}, ${p.currency}, ${p.shipping},
            ${p.nzd_per_unit}, ${p.fx_date}, ${p.total_nzd}, ${p.shipping_known}, ${p.match}, ${p.condition}, ${p.note}, ${p.by},
            ${p.at ?? new Date().toISOString()})
          ON CONFLICT (id) DO NOTHING`;
}

export async function setPriceStatus(id: string, status: "confirmed" | "rejected", by: string, why: string | null) {
  const q = await sql();
  const rows = await q`UPDATE market_prices SET status = ${status}, status_why = ${why}, status_by = ${by}, status_at = now()
                       WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}

/** One scan of one source replaces what that source lists (rows not in it are gone). */
export async function replaceSeen(source: string, rows: Omit<SeenRow, "source" | "seen_at">[]) {
  const q = await sql();
  const now = new Date().toISOString();
  await q.transaction([
    q`DELETE FROM market_seen WHERE source = ${source}`,
    ...rows.map((r) => q`INSERT INTO market_seen (source, key, product_id, match, title, ref, price_nzd, url, seen_at)
      VALUES (${source}, ${r.key}, ${r.product_id}, ${r.match}, ${r.title}, ${r.ref}, ${r.price_nzd}, ${r.url}, ${now})
      ON CONFLICT (source, key) DO NOTHING`),
  ]);
}

export async function addRadar(r: Omit<RadarRow, "supplier_cny" | "supplier_url" | "status" | "status_why" | "status_by" | "at"> & { shipping: number | null; at?: string; status?: string }) {
  const q = await sql();
  await q`INSERT INTO market_radar (id, brand, ref, name, scale, colour, family, url, price, currency, shipping, overseas_nzd,
            shipping_known, release, why, by, at, status)
          VALUES (${r.id}, ${r.brand}, ${r.ref}, ${r.name}, ${r.scale}, ${r.colour}, ${r.family}, ${r.url}, ${r.price}, ${r.currency},
            ${r.shipping}, ${r.overseas_nzd}, ${r.shipping_known}, ${r.release}, ${r.why}, ${r.by}, ${r.at ?? new Date().toISOString()},
            ${r.status ?? "proposed"})
          ON CONFLICT (id) DO NOTHING`;
}

export async function setRadar(id: string, f: { status?: "kept" | "dropped"; why?: string | null; supplier_cny?: number; supplier_url?: string | null }, by: string) {
  const q = await sql();
  const rows = f.supplier_cny != null
    ? await q`UPDATE market_radar SET supplier_cny = ${f.supplier_cny}, supplier_url = COALESCE(${f.supplier_url ?? null}, supplier_url),
                updated_at = now() WHERE id = ${id} RETURNING id`
    : await q`UPDATE market_radar SET status = ${f.status}, status_why = ${f.why ?? null}, status_by = ${by}, updated_at = now()
                WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
