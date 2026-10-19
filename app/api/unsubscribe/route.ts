import { NextRequest, NextResponse } from "next/server";
import { unsubscribe } from "@/lib/db";

// Each promo email links to /unsubscribe?t=<token> (a page with one button) and carries
// List-Unsubscribe / List-Unsubscribe-Post headers, so mail apps' one-click unsubscribe POSTs here directly.
export async function POST(request: NextRequest) {
  let token = request.nextUrl.searchParams.get("t") ?? "";
  if (!token) {
    const form = await request.formData().catch(() => null);
    token = String(form?.get("t") ?? "");
  }
  await unsubscribe(token.slice(0, 64)).catch(() => false);
  return NextResponse.redirect(new URL("/unsubscribe?done=1", request.url), 303);
}
