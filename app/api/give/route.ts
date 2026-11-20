import { NextRequest, NextResponse } from "next/server";
import { unstable_noStore as noStore } from "next/cache";
import { randomUUID } from "crypto";
import { addDonation, giveReport, voidDonation } from "@/lib/give";
import { pushTokenMatches, sessionRole } from "@/lib/session";
import { nzDate } from "@/lib/stock";

// $1 per model sold to the rescue helicopter. GET is public for www.driftae.com (totals only; donation records and
// receipts go to the team). POST records a donation the team made (`dt give add`) or voids a wrong one.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const revalidate = 0;

const ORIGINS = new Set(["https://www.driftae.com", "https://driftae.com", "http://localhost:4173", "http://localhost:5173"]);
const s = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

function cors(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { Vary: "Origin" };
}

export async function GET(request: NextRequest) {
  noStore();
  const headers = cors(request);
  try {
    const r = await giveReport();
    const team = sessionRole(request) || pushTokenMatches(request.headers.get("authorization"));
    return NextResponse.json(team ? r : { ...r, donations: undefined }, { headers: { ...headers, "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Please try again later" }, { status: 503, headers });
  }
}

export async function POST(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  const role = server ? null : sessionRole(request);
  if (!server && !role) return bad("Unauthorized", 401);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Bad body");
  const by = server ? `bot:${(s(b.by, 40) ?? "server").replace(/[^\w一-鿿-]/g, "")}` : `page:${role}`;
  if (b.action === "void") {
    const ok = await voidDonation(String(b.id ?? ""), `${by} ${nzDate(new Date())} ${s(b.why, 120) ?? ""}`.trim());
    return ok ? NextResponse.json({ success: true }) : bad("No such donation, or already voided", 404);
  }
  if (b.action !== "add") return bad("action add|void");
  const nzd = Number(b.nzd);
  if (!(nzd > 0 && nzd < 100000)) return bad("nzd is the amount given, a positive number");
  const day = s(b.day, 10) ?? nzDate(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad("day is YYYY-MM-DD");
  const id = randomUUID();
  await addDonation({ id, day, nzd, receipt: s(b.receipt, 500), note: s(b.note, 200), by });
  return NextResponse.json({ success: true, id });
}
