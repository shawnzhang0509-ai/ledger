import { NextRequest, NextResponse } from "next/server";

function isAuthenticated(request: NextRequest): boolean {
  const token = request.cookies.get("auth_token")?.value;
  const correctPassword = process.env.APP_PASSWORD;
  return Boolean(correctPassword && token === correctPassword);
}

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
  const { password } = await request.json();
  const correctPassword = process.env.APP_PASSWORD;

  if (!correctPassword) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  if (password === correctPassword) {
    const response = NextResponse.json({ success: true });
    response.cookies.set("auth_token", password, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });
    return response;
  }

  return NextResponse.json({ error: "Invalid password" }, { status: 401 });
}
