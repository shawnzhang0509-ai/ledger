import { NextRequest, NextResponse } from "next/server";
import { activeSubscribers, addSubscriber, subscriberCounts } from "@/lib/db";
import { pushTokenMatches } from "@/lib/session";
import { cleanEmail, newToken } from "@/lib/subscribe";

// The driftae-ops server (Bearer METRICS_PUSH_TOKEN): the bots add customers who gave their email in Messenger
// after the pre-approved question, and read the active list when an approved promo goes out.
export async function GET(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (request.nextUrl.searchParams.get("count")) return NextResponse.json(await subscriberCounts());
  return NextResponse.json({ subscribers: await activeSubscribers() });
}

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const email = cleanEmail(body.email);
  const consent = String(body.consent_text ?? "").trim().slice(0, 500);
  if (!email || !consent) return NextResponse.json({ error: "Need email and consent_text" }, { status: 400 });
  const added = await addSubscriber({ email, source: String(body.source ?? "messenger").slice(0, 20), consent_text: consent,
    psid: body.psid ? String(body.psid).slice(0, 64) : null, added_by: String(body.by ?? "bot").slice(0, 40), token: newToken() });
  return NextResponse.json({ ok: true, new: added });
}
