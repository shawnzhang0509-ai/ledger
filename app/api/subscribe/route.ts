import { NextRequest, NextResponse } from "next/server";
import { addSubscriber } from "@/lib/db";
import { cleanEmail, newToken } from "@/lib/subscribe";

// Public sign-up form on www.driftae.com. The visitor ticks the consent box; that wording is stored with them.
// The answer never says whether an address was already on the list.
const ORIGINS = new Set(["https://www.driftae.com", "https://driftae.com", "http://localhost:4173", "http://localhost:5173"]);
const CONSENT = "Website form: \"Email me new arrivals and members-only deals from DRIFTAE. Unsubscribe anytime.\"";

function cors(request: NextRequest): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  return ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Methods": "POST", "Access-Control-Allow-Headers": "Content-Type", Vary: "Origin" }
    : { Vary: "Origin" };
}

export function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: cors(request) });
}

export async function POST(request: NextRequest) {
  const headers = cors(request);
  if (!headers["Access-Control-Allow-Origin"]) return NextResponse.json({ error: "Forbidden" }, { status: 403, headers });
  const body = await request.json().catch(() => ({}));
  if (body.website) return NextResponse.json({ ok: true }, { headers });     // honeypot: bots fill every field
  const email = cleanEmail(body.email);
  if (!email || body.consent !== true) {
    return NextResponse.json({ error: "Enter a valid email and tick the box" }, { status: 400, headers });
  }
  try {
    await addSubscriber({ email, source: "website", consent_text: CONSENT, added_by: "website", token: newToken() });
  } catch {
    return NextResponse.json({ error: "Please try again later" }, { status: 503, headers });
  }
  return NextResponse.json({ ok: true }, { headers });
}
