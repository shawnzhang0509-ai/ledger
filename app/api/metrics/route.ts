import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { pushTokenMatches, sessionRole } from "@/lib/session";

const METRICS_KEY = "ops:metrics";
const MAX_BYTES = 512 * 1024;

// Admin and viewer read the ops metrics (numbers only: no customer names or messages).
export async function GET(request: NextRequest) {
  if (!sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const metrics = await getKvClient().get(METRICS_KEY);
  return NextResponse.json(metrics ?? null);
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
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || !("built" in body)) {
    return NextResponse.json({ error: "Missing built" }, { status: 400 });
  }
  await getKvClient().set(METRICS_KEY, body);
  return NextResponse.json({ success: true });
}
