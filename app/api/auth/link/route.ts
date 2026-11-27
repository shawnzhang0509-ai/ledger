import { NextRequest, NextResponse } from "next/server";
import { LINK_COOKIE, createSessionToken, viewLinkPass } from "@/lib/session";

// A bot's card link: /api/auth/link?t=<exp:role.mac> → a cookie with that role until the pass expires, then /ops. WeChat
// cards carry viewer (numbers, no customer names; orders stay behind the password); brain's 看全部 carries admin (lib/session).
// A bad or old pass just lands on /ops, which asks for the password as before.
export async function GET(request: NextRequest) {
  const pass = viewLinkPass(request.nextUrl.searchParams.get("t"));
  const exp = pass?.exp;
  const response = NextResponse.redirect(new URL("/ops", request.url), 303);
  const token = exp ? createSessionToken(pass!.role, exp) : null;
  if (exp && token) {
    response.cookies.set(LINK_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax", // opened from WeChat: a strict cookie would be missing on the redirect that follows
      maxAge: exp! - Math.floor(Date.now() / 1000),
      path: "/",
    });
  }
  return response;
}
