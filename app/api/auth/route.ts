import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  isAuthenticated,
  loginBlocked,
  passwordMatches,
  recordFailedLogin,
} from "@/lib/session";

export async function GET(request: NextRequest) {
  if (!process.env.APP_PASSWORD) {
    return NextResponse.json(
      { authenticated: false, error: "Server not configured" },
      { status: 500 }
    );
  }

  return NextResponse.json({ authenticated: isAuthenticated(request) });
}

export async function POST(request: NextRequest) {
  if (!process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  if (await loginBlocked(request)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const { password } = await request.json().catch(() => ({}));

  if (passwordMatches(password)) {
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, createSessionToken()!, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: SESSION_MAX_AGE,
      path: "/",
    });
    response.cookies.delete("auth_token"); // the old cookie held the password itself
    return response;
  }

  await recordFailedLogin(request);
  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  response.cookies.delete("auth_token");
  return response;
}
