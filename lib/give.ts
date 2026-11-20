import { neon } from "@neondatabase/serverless";
import { loadBooks } from "@/lib/books-server";

// $1 to the Westpac Rescue Helicopter for every model sold (owner 2026-11-21). The pledge is counted from the books
// (every sale since GIVE_SINCE that wasn't cancelled or returned); donations are what the team actually paid,
// recorded with the receipt. Append-only like the 分账: a wrong record is voided and stays visible.
export const GIVE = {
  charity: "Westpac Rescue Helicopter (Auckland Rescue Helicopter Trust)",
  charity_number: "CC21935",
  url: "https://www.rescuehelicopter.org.nz",
  per_sale: 1,
  since: "2026-11-21",
};

function client() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Error("DATABASE_NOT_CONFIGURED");
  return neon(url);
}

let ready = false;

async function sql() {
  const q = client();
  if (ready) return q;
  await q`CREATE TABLE IF NOT EXISTS give_donations (
    id TEXT PRIMARY KEY, day TEXT NOT NULL, nzd NUMERIC NOT NULL, receipt TEXT, note TEXT, by TEXT NOT NULL,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(), voided TEXT)`;
  ready = true;
  return q;
}

export async function addDonation(d: { id: string; day: string; nzd: number; receipt: string | null; note: string | null; by: string }) {
  const q = await sql();
  await q`INSERT INTO give_donations (id, day, nzd, receipt, note, by) VALUES (${d.id}, ${d.day}, ${d.nzd}, ${d.receipt}, ${d.note}, ${d.by})`;
}

export async function voidDonation(id: string, note: string) {
  const q = await sql();
  return (await q`UPDATE give_donations SET voided = ${note} WHERE id = ${id} AND voided IS NULL RETURNING id`).length > 0;
}

/** Sold since the start, pledged ($1 each), given (recorded donations), still to give; donations listed for the team. */
export async function giveReport() {
  const q = await sql();
  const [books, rows] = await Promise.all([loadBooks(), q`SELECT * FROM give_donations ORDER BY day DESC, at DESC`]);
  const sold = books.lines.filter((l) => l.dateSold >= GIVE.since && !l.returned && l.status !== "Cancelled").length;
  const donations = rows.map((r) => ({ id: r.id as string, day: r.day as string, nzd: Number(r.nzd), receipt: (r.receipt as string) ?? null,
                                       note: (r.note as string) ?? null, by: r.by as string, voided: (r.voided as string) ?? null }));
  const given = donations.filter((d) => !d.voided).reduce((s, d) => s + d.nzd, 0);
  const pledged = sold * GIVE.per_sale;
  return { ...GIVE, sold, pledged, given: Math.round(given * 100) / 100, to_give: Math.max(0, Math.round((pledged - given) * 100) / 100), donations };
}
