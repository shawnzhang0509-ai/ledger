import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// driftae.com visits from Vercel Web Analytics (production only): per day, top pages, top referrers.
// The Vercel token can do far more than read analytics, so it stays here in Vercel env (VERCEL_ANALYTICS_TOKEN)
// and the bots only get these numbers (Bearer METRICS_PUSH_TOKEN, `dt site traffic`). No visitor ids.
export const dynamic = "force-dynamic";

const API = "https://api.vercel.com/v1/query/web-analytics/visits";
type Row = { pageviews: number; visitors: number; [k: string]: unknown };

async function query(path: "count" | "aggregate", params: Record<string, string>) {
  const qs = new URLSearchParams({ projectId: process.env.VERCEL_ANALYTICS_PROJECT || "diecast", ...params });
  if (process.env.VERCEL_TEAM_ID) qs.set("teamId", process.env.VERCEL_TEAM_ID);
  const res = await fetch(`${API}/${path}?${qs}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_ANALYTICS_TOKEN}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`vercel_${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data;
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.VERCEL_ANALYTICS_TOKEN) {
    return NextResponse.json({ error: "VERCEL_ANALYTICS_TOKEN is not set" }, { status: 503 });
  }
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 7));
  const until = new Date();
  const since = new Date(until.getTime() - days * 86400000);
  const range = { since: since.toISOString(), until: until.toISOString() };
  const pick = (rows: Row[], key: string) =>
    rows.map((r) => ({ [key]: r[key] ?? "(none)", pageviews: r.pageviews, visitors: r.visitors }));
  try {
    const [totals, daily, pages, referrers] = await Promise.all([
      query("count", range),
      query("aggregate", { ...range, by: "day" }),
      query("aggregate", { ...range, by: "requestPath", limit: "50" }),
      query("aggregate", { ...range, by: "referrerHostname", limit: "20" }),
    ]);
    return NextResponse.json({
      ...range, days, totals,
      daily: (daily as Row[]).map((r) => ({ day: String(r.timestamp).slice(0, 10), pageviews: r.pageviews, visitors: r.visitors })),
      pages: pick(pages, "requestPath"),
      referrers: pick(referrers, "referrerHostname"),
    });
  } catch (error) {
    return NextResponse.json({ error: String(error instanceof Error ? error.message : error) }, { status: 502 });
  }
}
