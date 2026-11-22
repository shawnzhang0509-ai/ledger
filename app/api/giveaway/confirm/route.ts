import { NextRequest, NextResponse } from "next/server";
import { addSubscriber } from "@/lib/db";
import { confirmJoin } from "@/lib/giveaway-db";
import { newToken } from "@/lib/subscribe";

// The link in the giveaway confirmation mail (owner 2026-11-22: emails must be real). Clicking it makes the entry,
// adds the address to the email list with the wording the entrant ticked, and sends them back to the draw page.
export const dynamic = "force-dynamic";

const PAGE = "https://www.driftae.com/giveaway";
const CONSENT = "Giveaway form, email confirmed: \"Enter me in the draw and email me new arrivals and deals from DRIFTAE. Unsubscribe anytime.\"";

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  if (!/^[\w-]{10,64}$/.test(t)) return NextResponse.redirect(`${PAGE}?entered=bad`);
  try {
    const r = await confirmJoin(t);
    if (!r) return NextResponse.redirect(`${PAGE}?entered=bad`);
    if ("error" in r) return NextResponse.redirect(`${PAGE}?entered=closed`);
    await addSubscriber({ email: r.email, source: "giveaway", consent_text: CONSENT, added_by: "website", token: newToken() });
    return NextResponse.redirect(`${PAGE}?entered=${r.code}&month=${r.month}`);
  } catch {
    return NextResponse.redirect(`${PAGE}?entered=error`);
  }
}
