import { NextRequest, NextResponse } from "next/server";
import { LINK_COOKIE, createSessionToken, viewLinkExpiry } from "@/lib/session";

// A bot's card link: /api/auth/link?t=<exp:viewer.mac> → a viewer cookie until the pass expires, then /ops. Viewer only
// (the ops dashboard: numbers, no customer names); orders stay behind the admin password. A bad or old pass just lands
// on /ops, which asks for the password as before.
export async function GET(request: NextRequest) {
  const exp = viewLinkExpiry(request.nextUrl.searchParams.get("t"));
  const response = NextResponse.redirect(new URL("/ops", request.url), 303);
  const token = exp ? createSessionToken("viewer", exp) : null;
  if (exp && token) {
    response.cookies.set(LINK_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // opened from WeChat: a strict cookie would be missing on the redirect that follows
      maxAge: exp - Math.floor(Date.now() / 1000),
      path: "/",
    });
  }
  return response;
}
