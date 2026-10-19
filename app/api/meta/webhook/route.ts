import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { MessengerReferral, saveReferrals } from "@/lib/db";

// Meta's Messenger webhook for the Driftae Page. We keep only where a conversation came from
// (the ad, or the ?ref= on an m.me link such as a storefront product page) and the customer's
// page-scoped id, so `dt meta inbox` can say which ad or product each enquiry is about.
// Message text is never stored here: the agent reads conversations through the Graph API.

// Meta's verification handshake when the callback URL is saved in the app dashboard.
export function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const expected = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (expected && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === expected) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

function signatureValid(raw: string, header: string | null): boolean {
  const secret = process.env.META_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(raw, "utf8").digest("hex"));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && timingSafeEqual(expected, given);
}

type Referral = { ref?: string; source?: string; type?: string; ad_id?: string; ads_context_data?: { ad_title?: string } };
type MessagingEvent = {
  sender?: { id?: string }; timestamp?: number;
  referral?: Referral; message?: { referral?: Referral }; postback?: { referral?: Referral };
};

// Most events carry milliseconds, but m.me referral events have arrived in seconds.
const eventTime = (t?: number) => new Date(!t ? Date.now() : t < 1e12 ? t * 1000 : t).toISOString();
const clip = (v: unknown, n: number) => (v == null ? null : String(v).slice(0, n));

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!signatureValid(raw, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Bad signature" }, { status: 401 });
  }
  let body: { object?: string; entry?: { messaging?: MessagingEvent[]; standby?: MessagingEvent[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad body" }, { status: 400 });
  }
  if (body.object !== "page") return NextResponse.json({ ok: true });

  const rows: Omit<MessengerReferral, "id">[] = [];
  for (const entry of body.entry ?? []) {
    // Shape only (key names, never text or ids), to see which events Meta sends; remove once settled.
    console.log("messenger webhook", JSON.stringify({
      entry: Object.keys(entry),
      events: [...(entry.messaging ?? []), ...(entry.standby ?? [])].map((ev) => ({
        keys: Object.keys(ev),
        message: ev.message ? Object.keys(ev.message) : undefined,
        postback: ev.postback ? Object.keys(ev.postback) : undefined,
      })),
    }));
    // standby: when another app is the Page's primary receiver, events arrive here instead.
    for (const ev of [...(entry.messaging ?? []), ...(entry.standby ?? [])]) {
      // messaging_referrals events carry it at the top; a first message from an ad, or a Get Started
      // postback, carries it inside the message / postback.
      const r = ev.referral ?? ev.message?.referral ?? ev.postback?.referral;
      if (!r || !ev.sender?.id) continue;
      rows.push({
        psid: clip(ev.sender.id, 64)!, source: clip(r.source, 40), type: clip(r.type, 40), ref: clip(r.ref, 200),
        ad_id: clip(r.ad_id, 40), ad_title: clip(r.ads_context_data?.ad_title, 200),
        at: eventTime(ev.timestamp),
      });
    }
  }
  // Meta wants a 200 within 5 s and disables the webhook after an hour of failures; a database
  // hiccup must not turn into that, so it is logged and still acknowledged.
  await saveReferrals(rows).catch((e) => console.error("messenger referral save failed", e));
  return NextResponse.json({ ok: true });
}
