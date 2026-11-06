import { NextRequest, NextResponse } from "next/server";
import { pushTokenMatches } from "@/lib/session";

// WeChat's media CDN from the bots' server (DigitalOcean Sydney): IPv4 never connects and 150 KB takes 30 s over IPv6,
// so pictures fail however small they are (2026-11-06). The server sends its already encrypted upload here and this
// function passes it on, in 2 s. Only that CDN's upload path; the key to the picture never comes through here.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const HOST = "novac2c.cdn.weixin.qq.com";

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let url: URL;
  try {
    url = new URL(request.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return NextResponse.json({ error: "Bad url" }, { status: 400 });
  }
  if (url.protocol !== "https:" || url.hostname !== HOST || !url.pathname.startsWith("/c2c/upload")) {
    return NextResponse.json({ error: "Not the WeChat upload" }, { status: 400 });
  }
  const t0 = Date.now();
  const r = await fetch(url, { method: "POST", body: await request.arrayBuffer(), headers: { "Content-Type": "application/octet-stream" } });
  const headers = new Headers({ "x-relay-ms": String(Date.now() - t0), "x-relay-region": process.env.VERCEL_REGION ?? "" });
  for (const h of ["x-encrypted-param", "x-error-code", "x-error-message"]) {
    const v = r.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new NextResponse(await r.arrayBuffer(), { status: r.status, headers });
}
