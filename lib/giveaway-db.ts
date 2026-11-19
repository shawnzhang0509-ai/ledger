import { neon } from "@neondatabase/serverless";
import { randomInt } from "crypto";

// The monthly draw (owner 2026-11-19), shown on www.driftae.com/giveaway. Free to enter (NZ Gambling Act sales
// promotion rules: no entry fee, rules fixed before it starts). Only a masked name is ever stored ("J*** S."): the
// entry id (Facebook comment id, Trade Me order id) is how the team finds the winner, nothing else about people.
// The winner is drawn here, once, after the end time, with a cryptographic random pick; the page replays it.
function client() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  return neon(url);
}

let ready = false;

async function sql() {
  const q = client();
  if (ready) return q;
  await q`CREATE TABLE IF NOT EXISTS giveaway_draws (
    month TEXT PRIMARY KEY, product_id TEXT, prize TEXT NOT NULL, prize_value NUMERIC, image TEXT,
    ends_at TIMESTAMPTZ NOT NULL, winner TEXT, drawn_at TIMESTAMPTZ, by TEXT NOT NULL, at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await q`CREATE TABLE IF NOT EXISTS giveaway_entries (
    id TEXT PRIMARY KEY, month TEXT NOT NULL, display TEXT NOT NULL, via TEXT NOT NULL, by TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(), voided TEXT)`;
  ready = true;
  return q;
}

export const VIA = ["Facebook", "Instagram", "Trade Me", "Website"] as const;
export type Via = (typeof VIA)[number];

/** "Jane Smith" → "J*** S.", "kiwicollector88" → "ki***". Nothing longer is kept. */
export function maskName(raw: string) {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "***";
  if (parts.length === 1) return `${[...parts[0]].slice(0, 2).join("")}***`;
  return `${[...parts[0]][0]}*** ${[...parts[parts.length - 1]][0].toUpperCase()}.`;
}

export type Draw = { month: string; product_id: string | null; prize: string; prize_value: number | null; image: string | null;
  ends_at: string; winner: string | null; drawn_at: string | null };
export type Entry = { id: string; display: string; via: Via };

const toDraw = (r: Record<string, unknown>): Draw => ({
  month: r.month as string, product_id: (r.product_id as string) ?? null, prize: r.prize as string,
  prize_value: r.prize_value == null ? null : Number(r.prize_value), image: (r.image as string) ?? null,
  ends_at: new Date(r.ends_at as string).toISOString(), winner: (r.winner as string) ?? null,
  drawn_at: r.drawn_at ? new Date(r.drawn_at as string).toISOString() : null,
});

export async function loadDraw(month?: string) {
  const q = await sql();
  const rows = month ? await q`SELECT * FROM giveaway_draws WHERE month = ${month}`
    : await q`SELECT * FROM giveaway_draws ORDER BY month DESC LIMIT 1`;
  if (!rows.length) return null;
  const draw = toDraw(rows[0]);
  const entries = (await q`SELECT id, display, via FROM giveaway_entries WHERE month = ${draw.month} AND voided IS NULL ORDER BY id`) as unknown as Entry[];
  return { draw, entries };
}

/** Set a month's prize and end time. Refused once the month has entries: the rules can't change after it starts. */
export async function setDraw(d: Omit<Draw, "winner" | "drawn_at">, by: string) {
  const q = await sql();
  const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM giveaway_entries WHERE month = ${d.month}`;
  if (n > 0) return false;
  await q`INSERT INTO giveaway_draws (month, product_id, prize, prize_value, image, ends_at, by)
    VALUES (${d.month}, ${d.product_id}, ${d.prize}, ${d.prize_value}, ${d.image}, ${d.ends_at}, ${by})
    ON CONFLICT (month) DO UPDATE SET product_id = EXCLUDED.product_id, prize = EXCLUDED.prize, prize_value = EXCLUDED.prize_value,
      image = EXCLUDED.image, ends_at = EXCLUDED.ends_at, by = EXCLUDED.by, at = NOW()`;
  return true;
}

/** Add entries (one per id: a second comment or order with the same id is ignored). Only before the end time. */
export async function addEntries(month: string, list: { id: string; name: string; via: Via }[], by: string) {
  const q = await sql();
  const [draw] = await q`SELECT ends_at, winner FROM giveaway_draws WHERE month = ${month}`;
  if (!draw) return { error: "No draw set for that month" };
  if (draw.winner || new Date(draw.ends_at as string) <= new Date()) return { error: "Entries are closed" };
  let added = 0;
  for (const e of list) {
    const r = await q`INSERT INTO giveaway_entries (id, month, display, via, by) VALUES (${e.id}, ${month}, ${maskName(e.name)}, ${e.via}, ${by})
      ON CONFLICT (id) DO NOTHING RETURNING id`;
    added += r.length;
  }
  return { added };
}

export async function voidEntry(id: string, note: string) {
  const q = await sql();
  const r = await q`UPDATE giveaway_entries SET voided = ${note} WHERE id = ${id} AND voided IS NULL
    AND month NOT IN (SELECT month FROM giveaway_draws WHERE winner IS NOT NULL) RETURNING id`;
  return r.length > 0;
}

/** The draw: once, after the end time, one random entry. Returns the winning entry id. */
export async function drawWinner(month: string, by: string) {
  const q = await sql();
  const [draw] = await q`SELECT ends_at, winner FROM giveaway_draws WHERE month = ${month}`;
  if (!draw) return { error: "No draw set for that month" };
  if (draw.winner) return { error: "Already drawn", winner: draw.winner as string };
  if (new Date(draw.ends_at as string) > new Date()) return { error: "Not ended yet" };
  const entries = await q`SELECT id FROM giveaway_entries WHERE month = ${month} AND voided IS NULL ORDER BY id`;
  if (!entries.length) return { error: "No entries" };
  const winner = entries[randomInt(entries.length)].id as string;
  const r = await q`UPDATE giveaway_draws SET winner = ${winner}, drawn_at = NOW(), by = ${by} WHERE month = ${month} AND winner IS NULL RETURNING winner`;
  return r.length ? { winner } : { error: "Already drawn" };
}
