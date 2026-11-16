import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, createSessionToken, foreverLinkValid } from "@/lib/session";

// The forever link: /go?k=… logs this browser in and opens the home page. Works every time it is tapped, so a
// WeChat browser that forgets cookies still gets straight in. A wrong key just lands on the password box.
export async function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/", request.url), 303);
  if (foreverLinkValid(request.nextUrl.searchParams.get("k"))) {
    const token = createSessionToken("admin", Math.floor(Date.now() / 1000) + 10 * 365 * 86400);
    if (token) {
      response.cookies.set(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax", // opened from WeChat
        maxAge: 400 * 86400, // browsers cap cookies at 400 days; the link itself never expires
        path: "/",
      });
    }
  }
  return response;
}
