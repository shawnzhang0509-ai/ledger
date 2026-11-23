import { neon } from "@neondatabase/serverless";
import { randomBytes, randomInt } from "crypto";

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
  // website entrants: their invite code, their Instagram handle (the winner's follow + tag is checked by hand), who invited them
  await q`CREATE TABLE IF NOT EXISTS giveaway_people (
    month TEXT NOT NULL, email TEXT NOT NULL, code TEXT NOT NULL UNIQUE, ig TEXT, ref TEXT,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (month, email))`;
  // owner 2026-11-22: an entry counts only once the email is confirmed (link in a mail the server sends), and every
  // entrant gives the link to their own Instagram post tagging us (checked by hand for the winner)
  await q`ALTER TABLE giveaway_people ADD COLUMN IF NOT EXISTS name TEXT`;
  await q`ALTER TABLE giveaway_people ADD COLUMN IF NOT EXISTS post_url TEXT`;
  await q`ALTER TABLE giveaway_people ADD COLUMN IF NOT EXISTS confirm_token TEXT UNIQUE`;
  await q`ALTER TABLE giveaway_people ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`;
  await q`ALTER TABLE giveaway_people ADD COLUMN IF NOT EXISTS mailed_at TIMESTAMPTZ`;
  ready = true;
  return q;
}

export const VIA = ["Facebook", "Instagram", "Trade Me", "Website", "Invite"] as const;
export type Via = (typeof VIA)[number];

/** "Jane Smith" → "J*** S.", "kiwicollector88" → "ki***". Nothing longer is kept. */
export function maskName(raw: string) {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "***";
  if (parts.length === 1) return `${Array.from(parts[0]).slice(0, 2).join("")}***`;
  return `${Array.from(parts[0])[0]}*** ${Array.from(parts[parts.length - 1])[0].toUpperCase()}.`;
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

/** The winner's post doesn't pass the hand check (owner 2026-11-22): their entry is voided, the draw is run again. */
export async function redraw(month: string, why: string, by: string) {
  const q = await sql();
  const [draw] = await q`SELECT winner FROM giveaway_draws WHERE month = ${month}`;
  if (!draw?.winner) return { error: "Not drawn yet" };
  const note = `${by} redraw ${why}`.trim();
  const email = /^(?:web|bonus):\d{4}-\d{2}:([^:]+)/.exec(draw.winner as string)?.[1];
  if (email) {        // a website entrant: every entry of theirs goes, the invite bonuses too
    await q`UPDATE giveaway_entries SET voided = ${note} WHERE month = ${month} AND voided IS NULL
      AND (id = ${`web:${month}:${email}`} OR id LIKE ${`bonus:${month}:${email}:%`})`;
  }
  await q`UPDATE giveaway_entries SET voided = ${note} WHERE id = ${draw.winner} AND voided IS NULL`;
  await q`UPDATE giveaway_draws SET winner = NULL, drawn_at = NULL WHERE month = ${month} AND winner = ${draw.winner}`;
  return drawWinner(month, by);
}

/** For the team's card: website entrants (confirmed or still waiting on the email) and invite chances. */
export async function drawStats(month: string) {
  const q = await sql();
  const [p] = await q`SELECT COUNT(*) FILTER (WHERE confirmed_at IS NOT NULL)::int AS confirmed,
    COUNT(*) FILTER (WHERE confirmed_at IS NULL)::int AS pending FROM giveaway_people WHERE month = ${month}`;
  const [e] = await q`SELECT COUNT(*) FILTER (WHERE via = 'Invite')::int AS invites FROM giveaway_entries WHERE month = ${month} AND voided IS NULL`;
  return { confirmed: p.confirmed as number, pending: p.pending as number, invites: e.invites as number };
}

export const MAX_INVITES = 5;
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const newCode = () => Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join("");

/** Step 1 of a website entry: remember the person (pending) until they click the link in the confirmation mail.
 * Someone already confirmed gets their invite code and counts back instead. */
export async function requestJoin(month: string, p: { email: string; name: string; post: string; ref: string | null }) {
  const q = await sql();
  const [me] = await q`SELECT code, confirmed_at, mailed_at FROM giveaway_people WHERE month = ${month} AND email = ${p.email}`;
  if (me?.confirmed_at) {
    await q`UPDATE giveaway_people SET post_url = ${p.post} WHERE month = ${month} AND email = ${p.email}`;
    return { confirmed: true as const, ...(await inviteStats(month, me.code as string)) };
  }
  if (me) {   // asked again before confirming: new post link, and the mail goes out again if the last one is 10+ min old
    await q`UPDATE giveaway_people SET name = ${p.name}, post_url = ${p.post},
      mailed_at = CASE WHEN mailed_at < NOW() - INTERVAL '10 minutes' THEN NULL ELSE mailed_at END
      WHERE month = ${month} AND email = ${p.email}`;
    return { confirmed: false as const };
  }
  let ref: string | null = null;
  if (p.ref) {
    const [inviter] = await q`SELECT email FROM giveaway_people WHERE month = ${month} AND code = ${p.ref.toUpperCase()} AND confirmed_at IS NOT NULL`;
    if (inviter && inviter.email !== p.email) ref = inviter.email as string;
  }
  for (let i = 0; i < 5; i++) {
    const r = await q`INSERT INTO giveaway_people (month, email, code, name, post_url, ref, confirm_token)
      VALUES (${month}, ${p.email}, ${newCode()}, ${p.name}, ${p.post}, ${ref}, ${randomBytes(18).toString("base64url")})
      ON CONFLICT DO NOTHING RETURNING code`;
    if (r.length) break;
    const [again] = await q`SELECT 1 FROM giveaway_people WHERE month = ${month} AND email = ${p.email}`;
    if (again) break;      // the same person, twice at once
  }
  return { confirmed: false as const };
}

/** Step 2: the link in the mail. Makes the entry, and the inviter's extra one (max 5). Returns the month and code. */
export async function confirmJoin(token: string) {
  const q = await sql();
  const [p] = await q`SELECT month, email, name, code, ref, confirmed_at FROM giveaway_people WHERE confirm_token = ${token}`;
  if (!p) return null;
  const month = p.month as string, email = p.email as string;
  if (!p.confirmed_at) {
    const r = await addEntries(month, [{ id: `web:${month}:${email}`, name: p.name as string, via: "Website" }], "website");
    if ("error" in r) return { month, code: p.code as string, error: r.error as string };
    await q`UPDATE giveaway_people SET confirmed_at = NOW() WHERE month = ${month} AND email = ${email}`;
    if (p.ref) {
      const ref = p.ref as string;
      const [{ n }] = await q`SELECT COUNT(*)::int AS n FROM giveaway_entries WHERE month = ${month} AND via = 'Invite'
        AND id LIKE ${`bonus:${month}:${ref}:%`}`;
      const [host] = await q`SELECT display FROM giveaway_entries WHERE id = ${`web:${month}:${ref}`}`;
      if (n < MAX_INVITES && host) {
        await q`INSERT INTO giveaway_entries (id, month, display, via, by) VALUES (${`bonus:${month}:${ref}:${email}`}, ${month},
          ${host.display}, 'Invite', 'website') ON CONFLICT (id) DO NOTHING`;
      }
    }
  }
  return { month, code: p.code as string, email };
}

/** Friends who confirmed through this code, and the person's chances. Public by code (the code is the link). */
export async function inviteStats(month: string, code: string) {
  const q = await sql();
  const [me] = await q`SELECT email FROM giveaway_people WHERE month = ${month} AND code = ${code.toUpperCase()} AND confirmed_at IS NOT NULL`;
  if (!me) return { code: null, invited: 0, chances: 0 };
  const [{ invited }] = await q`SELECT COUNT(*)::int AS invited FROM giveaway_people WHERE month = ${month} AND ref = ${me.email}
    AND confirmed_at IS NOT NULL`;
  const [{ bonus }] = await q`SELECT COUNT(*)::int AS bonus FROM giveaway_entries WHERE month = ${month} AND via = 'Invite'
    AND voided IS NULL AND id LIKE ${`bonus:${month}:${me.email}:%`}`;
  return { code: code.toUpperCase(), invited: invited as number, chances: 1 + (bonus as number) };
}

/** Confirmation mails still to send (the server sends them, then marks them). */
export async function mailOutbox() {
  const q = await sql();
  return (await q`SELECT email, name, confirm_token AS token, month FROM giveaway_people
    WHERE confirmed_at IS NULL AND mailed_at IS NULL AND at > NOW() - INTERVAL '3 days' ORDER BY at LIMIT 50`) as
    { email: string; name: string; token: string; month: string }[];
}

export async function markMailed(tokens: string[]) {
  const q = await sql();
  if (tokens.length) await q`UPDATE giveaway_people SET mailed_at = NOW() WHERE confirm_token = ANY(${tokens})`;
}

/** The team checks the winner by hand: their email and Instagram post (bonus entries win for the inviter). */
export async function winnerContact(month: string, entryId: string) {
  const m = /^(?:web|bonus):\d{4}-\d{2}:([^:]+)/.exec(entryId);
  if (!m) return null;
  const q = await sql();
  const [p] = await q`SELECT post_url FROM giveaway_people WHERE month = ${month} AND email = ${m[1]}`;
  return { email: m[1], instagram_post: (p?.post_url as string) ?? null };
}
