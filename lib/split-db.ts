import { neon } from "@neondatabase/serverless";
import type { SplitEntry } from "@/lib/split";

// The 分账 records (Postgres). Append-only: a wrong entry is voided (who, when) and stays visible, never edited or deleted.
function client() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  return neon(url);
}

let ready = false;

async function sql() {
  const q = client();
  if (ready) return q;
  await q`CREATE TABLE IF NOT EXISTS split_entries (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, who TEXT NOT NULL, kind TEXT NOT NULL, "to" TEXT, category TEXT,
    nzd NUMERIC NOT NULL, cny NUMERIC, rate NUMERIC, what TEXT, order_id TEXT, by TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(), voided TEXT)`;
  ready = true;
  return q;
}

const num = (v: unknown) => (v == null ? null : Number(v));

export async function loadSplitEntries(): Promise<SplitEntry[]> {
  const q = await sql();
  const rows = await q`SELECT * FROM split_entries ORDER BY day DESC, at DESC`;
  return rows.map((r) => ({ ...r, nzd: Number(r.nzd), cny: num(r.cny), rate: num(r.rate), at: new Date(r.at as string).toISOString() })) as SplitEntry[];
}

export async function addSplitEntry(e: Omit<SplitEntry, "at" | "voided">) {
  const q = await sql();
  await q`INSERT INTO split_entries (id, day, who, kind, "to", category, nzd, cny, rate, what, order_id, by)
    VALUES (${e.id}, ${e.day}, ${e.who}, ${e.kind}, ${e.to}, ${e.category}, ${e.nzd}, ${e.cny}, ${e.rate}, ${e.what}, ${e.order_id}, ${e.by})`;
}

export async function voidSplitEntry(id: string, note: string) {
  const q = await sql();
  const r = await q`UPDATE split_entries SET voided = ${note} WHERE id = ${id} AND voided IS NULL RETURNING id`;
  return r.length > 0;
}
