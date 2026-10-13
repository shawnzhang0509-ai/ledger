import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { hasDatabase, metricHistory, saveSnapshot } from "@/lib/db";
import { pushTokenMatches, sessionRole } from "@/lib/session";

const METRICS_KEY = "ops:metrics";
const MAX_BYTES = 512 * 1024;

// Admin and viewer read the ops metrics (numbers only: no customer names or messages),
// plus 30 days of daily history per metric when the Postgres database is connected.
export async function GET(request: NextRequest) {
  if (!sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const latest = await getKvClient().get(METRICS_KEY);
  let history: Awaited<ReturnType<typeof metricHistory>> = [];
  try {
    history = await metricHistory(30);
  } catch (error) {
    console.error("metric history:", error); // trends are optional; the latest numbers still show
  }
  return NextResponse.json({ latest: latest ?? null, history, database: hasDatabase() });
}

// The driftae-ops server pushes them with METRICS_PUSH_TOKEN; that token can do nothing else.
export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const text = await request.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Too large" }, { status: 413 });
  }
  let body: { built?: string; metrics?: { id: string; value: number | null; target: number | null; status: string }[] };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !body.built) {
    return NextResponse.json({ error: "Missing built" }, { status: 400 });
  }
  await getKvClient().set(METRICS_KEY, body);
  let stored = false;
  if (Array.isArray(body.metrics)) {
    try {
      stored = await saveSnapshot(body.built, body, body.metrics);
    } catch (error) {
      console.error("save snapshot:", error);
    }
  }
  return NextResponse.json({ success: true, history: stored });
}
