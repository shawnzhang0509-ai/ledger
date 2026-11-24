import { NextRequest, NextResponse } from "next/server";
import { confirmSubscribe } from "@/lib/db";

// The link in the sign-up confirmation mail: adds the address to the list, then back to the shop with a note.
export const dynamic = "force-dynamic";

const SITE = "https://www.driftae.com/";

export async function GET(request: NextRequest) {
  const t = request.nextUrl.searchParams.get("t") ?? "";
  if (!/^[\w-]{10,64}$/.test(t)) return NextResponse.redirect(`${SITE}?subscribed=bad`);
  try {
    return NextResponse.redirect(`${SITE}?subscribed=${(await confirmSubscribe(t)) ? "1" : "bad"}`);
  } catch {
    return NextResponse.redirect(`${SITE}?subscribed=error`);
  }
}
