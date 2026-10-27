import { NextRequest, NextResponse } from "next/server";
import {
  LINK_COOKIE,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
  createSessionToken,
  loginBlocked,
  passwordRole,
  recordFailedLogin,
  sessionRole,
} from "@/lib/session";

export async function GET(request: NextRequest) {
  if (!process.env.APP_PASSWORD) {
    return NextResponse.json(
      { authenticated: false, error: "Server not configured" },
      { status: 500 }
    );
  }

  const role = sessionRole(request);
  return NextResponse.json({ authenticated: role !== null, role });
}

export async function POST(request: NextRequest) {
  if (!process.env.APP_PASSWORD) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  if (await loginBlocked(request)) {
    return NextResponse.json({ error: "Too many attempts" }, { status: 429 });
  }

  const { password } = await request.json().catch(() => ({}));

  const role = passwordRole(password);
  if (role) {
    const response = NextResponse.json({ success: true, role });
    response.cookies.set(SESSION_COOKIE, createSessionToken(role)!, {
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
  response.cookies.delete(LINK_COOKIE);
  response.cookies.delete("auth_token");
  return response;
}
