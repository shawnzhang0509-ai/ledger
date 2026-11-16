import { NextRequest, NextResponse } from "next/server";
import { foreverLinkKey, sessionRole } from "@/lib/session";

// The forever link, for someone already logged in with the password (not a bot's view link).
export async function GET(request: NextRequest) {
  if (sessionRole(request) !== "admin") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const k = foreverLinkKey();
  if (!k) return NextResponse.json({ error: "No password set" }, { status: 500 });
  return NextResponse.json({ url: new URL(`/go?k=${k}`, request.url).toString() });
}
