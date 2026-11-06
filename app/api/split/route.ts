import { NextRequest, NextResponse } from "next/server";
import { addSplitEntry, voidSplitEntry } from "@/lib/split-db";
import { loadSplitReport } from "@/lib/split-server";
import { KINDS, Kind, PEOPLE, Person } from "@/lib/split";
import { nzdPerCny } from "@/lib/market-server";
import { nzDate } from "@/lib/stock";
import { pushTokenMatches, sessionRole } from "@/lib/session";

// 分账: the report (GET) and its records (POST), from the bots (`dt split …`, `by` = who asked) and the /split page.
export const dynamic = "force-dynamic";

const s = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const isPerson = (v: unknown): v is Person => typeof v === "string" && v in PEOPLE;

export async function GET(request: NextRequest) {
  if (!sessionRole(request) && !pushTokenMatches(request.headers.get("authorization"))) return bad("Unauthorized", 401);
  return NextResponse.json(await loadSplitReport());
}

export async function POST(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  const role = server ? null : sessionRole(request);
  if (!server && !role) return bad("Unauthorized", 401);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Bad body");
  const by = server ? `bot:${(s(b.by, 40) ?? "server").replace(/[^\w一-鿿-]/g, "")}` : `page:${role}`;

  if (b.action === "void") {
    const ok = await voidSplitEntry(String(b.id ?? ""), `${by} ${nzDate(new Date())} ${s(b.why, 120) ?? ""}`.trim());
    return ok ? NextResponse.json({ success: true }) : bad("No such entry, or already voided", 404);
  }
  if (b.action !== "add") return bad("action add|void");

  const kind = b.kind as Kind;
  if (!isPerson(b.who) || !(kind in KINDS)) return bad("Need who shawn|wife|stella and kind capital|advance|transfer");
  if (kind === "transfer" && (!isPerson(b.to) || b.to === b.who)) return bad("A transfer needs `to`, another person");
  const day = s(b.day, 10) ?? nzDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad("day is YYYY-MM-DD");

  const cny = b.cny == null || b.cny === "" ? null : Number(b.cny);
  let nzd = b.nzd == null || b.nzd === "" ? null : Number(b.nzd);
  let rate = b.rate == null || b.rate === "" ? null : Number(b.rate);   // CNY per NZD
  if (cny != null && nzd == null) {
    if (rate == null) {
      const today = await nzdPerCny();
      rate = today ? Math.round((1 / today) * 10000) / 10000 : null;
    }
    if (!rate || rate <= 0) return bad("No exchange rate today: give nzd or rate");
    nzd = cny / rate;
  }
  if (nzd == null || !Number.isFinite(nzd) || nzd <= 0 || (cny != null && (!Number.isFinite(cny) || cny <= 0))) return bad("Need a positive nzd or cny");

  const id = crypto.randomUUID().slice(0, 8);
  await addSplitEntry({ id, day, who: b.who, kind, to: kind === "transfer" ? b.to : null, category: s(b.category, 20),
    nzd: Math.round(nzd * 100) / 100, cny, rate, what: s(b.what, 200), order_id: s(b.order_id, 40), by });
  return NextResponse.json({ success: true, id, nzd: Math.round(nzd * 100) / 100, rate });
}
