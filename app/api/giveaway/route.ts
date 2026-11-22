import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { addEntries, drawWinner, inviteStats, loadDraw, mailOutbox, markMailed, requestJoin, setDraw, VIA, Via, voidEntry, winnerContact } from "@/lib/giveaway-db";
import { pushTokenMatches, sessionRole } from "@/lib/session";
import { cleanEmail } from "@/lib/subscribe";

// The monthly draw. GET is public for www.driftae.com/giveaway: prize, end time, masked entries, the winner once drawn
// (entry ids stay here; the page gets positions only). POST is the bots (`dt giveaway …`) and the team's pages, plus the
// page's own entry form (action "join"): name + email + their Instagram post tagging us + one consent box. The point of
// the draw is the email list (owner 2026-11-21), so an entry is also a subscriber; the box says so. One entry per email
// per month, and only once the email is confirmed (owner 2026-11-22): the server mails the link (actions outbox/mailed),
// /api/giveaway/confirm makes the entry.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const ORIGINS = new Set(["https://www.driftae.com", "https://driftae.com", "http://localhost:4173", "http://localhost:5173"]);
const s = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const MONTH = /^\d{4}-\d{2}$/;


function cors(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "GET, POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : { Vary: "Origin" };
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

/** The public entry form. Says the same thing whether the email was new or already in. */
async function join(request: NextRequest, b: Record<string, unknown>) {
  const headers = cors(request);
  if (!headers["Access-Control-Allow-Origin"]) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  if (b.website) return NextResponse.json({ ok: true }, { headers });          // honeypot: bots fill every field
  const email = cleanEmail(b.email), name = s(b.name, 60);
  const post = /^https?:\/\/(?:www\.)?instagram\.com\/(?:[\w.]+\/)?(?:p|reel|reels)\/[\w-]+/.exec(s(b.post, 300) ?? "")?.[0]
    .replace(/^http:/, "https:") ?? null;
  const ref = s(b.ref, 12)?.replace(/[^A-Za-z0-9]/g, "") || null;
  if (!email || !name || b.consent !== true) {
    return NextResponse.json({ error: "Enter your name and a valid email, and tick the box" }, { status: 400, headers });
  }
  if (!post) return NextResponse.json({ error: "Paste the link to your Instagram post (instagram.com/p/…)" }, { status: 400, headers });
  try {
    const found = await loadDraw();
    if (!found || found.draw.winner || new Date(found.draw.ends_at) <= new Date()) {
      return NextResponse.json({ error: "Entries are closed. The next draw opens soon." }, { status: 409, headers });
    }
    const r = await requestJoin(found.draw.month, { email, name, post, ref });
    return NextResponse.json({ ok: true, month: found.draw.month, ...r }, { headers });
  } catch {
    return NextResponse.json({ error: "Please try again later" }, { status: 503, headers });
  }
}

export async function GET(request: NextRequest) {
  noStore();
  const headers = cors(request);
  const month = request.nextUrl.searchParams.get("month");
  if (month && !MONTH.test(month)) return NextResponse.json({ error: "month is YYYY-MM" }, { status: 400, headers });
  const code = request.nextUrl.searchParams.get("code");
  try {
    if (code && /^[A-Za-z0-9]{4,12}$/.test(code)) {      // the entered page: this person's invite count
      const found = await loadDraw(month ?? undefined);
      return NextResponse.json(found ? await inviteStats(found.draw.month, code) : { code: null }, { headers: { ...headers, "Cache-Control": "no-store" } });
    }
    const team = sessionRole(request) || pushTokenMatches(request.headers.get("authorization"));
    const found = await loadDraw(month ?? undefined);
    if (!found) return NextResponse.json({ draw: null }, { headers });
    const { draw, entries } = found;
    const winnerIndex = draw.winner ? entries.findIndex((e) => e.id === draw.winner) : -1;
    return NextResponse.json({
      draw: { month: draw.month, product_id: draw.product_id, prize: draw.prize, prize_value: draw.prize_value, image: draw.image,
              ends_at: draw.ends_at, drawn_at: draw.drawn_at },
      entries: entries.map((e) => ({ display: e.display, via: e.via, ...(team ? { id: e.id } : {}) })),
      winner: winnerIndex >= 0 ? { index: winnerIndex, display: entries[winnerIndex].display, via: entries[winnerIndex].via,
                                   ...(team ? { id: draw.winner, contact: await winnerContact(draw.month, draw.winner as string) } : {}) } : null,
    }, { headers: { ...headers, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Please try again later" }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Bad body");
  if (b.action === "join") return join(request, b);
  const server = pushTokenMatches(request.headers.get("authorization"));
  const role = server ? null : sessionRole(request);
  if (!server && !role) return bad("Unauthorized", 401);
  const by = server ? `bot:${(s(b.by, 40) ?? "server").replace(/[^\w一-鿿-]/g, "")}` : `page:${role}`;
  if (b.action === "outbox") return NextResponse.json({ mails: await mailOutbox() });
  if (b.action === "mailed") {
    await markMailed(Array.isArray(b.tokens) ? b.tokens.filter((t: unknown) => typeof t === "string").slice(0, 100) : []);
    return NextResponse.json({ success: true });
  }
  const month = s(b.month, 7);
  if (!month || !MONTH.test(month)) return bad("month is YYYY-MM");

  if (b.action === "set") {
    const prize = s(b.prize, 120), ends = s(b.ends_at, 40);
    if (!prize || !ends || isNaN(Date.parse(ends))) return bad("Need prize and ends_at (ISO time)");
    const value = b.prize_value == null ? null : Number(b.prize_value);
    if (value != null && !(value > 0)) return bad("prize_value is a positive number");
    const image = s(b.image, 500);
    if (image && !image.startsWith("https://")) return bad("image is an https URL");
    const ok = await setDraw({ month, product_id: s(b.product_id, 120), prize, prize_value: value, image,
                               ends_at: new Date(ends).toISOString() }, by);
    return ok ? NextResponse.json({ success: true }) : bad("This month already has entries: its rules can't change now", 409);
  }
  if (b.action === "enter") {
    const list = Array.isArray(b.entries) ? b.entries.slice(0, 500) : [];
    const clean: { id: string; name: string; via: Via }[] = [];
    for (const e of list as Record<string, unknown>[]) {
      const id = s(e?.id, 120), name = s(e?.name, 80), via = e?.via as Via;
      if (id && name && VIA.includes(via)) clean.push({ id, name, via });
    }
    if (!clean.length) return bad(`entries: [{id, name, via: ${VIA.join("|")}}]`);
    const r = await addEntries(month, clean, by);
    return "error" in r ? bad(r.error as string, 409) : NextResponse.json({ success: true, added: r.added, given: clean.length });
  }
  if (b.action === "void") {
    const ok = await voidEntry(String(b.id ?? ""), `${by} ${s(b.why, 120) ?? ""}`.trim());
    return ok ? NextResponse.json({ success: true }) : bad("No such entry, already voided, or already drawn", 404);
  }
  if (b.action === "draw") {
    const r = await drawWinner(month, by);
    return "error" in r ? NextResponse.json(r, { status: 409 }) : NextResponse.json({ success: true, winner: r.winner });
  }
  return bad("action join|set|enter|void|draw|outbox|mailed");
}
