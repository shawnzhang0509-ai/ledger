import { NextRequest, NextResponse } from "next/server";
import { copyObject, deleteObject, listKeys } from "@/lib/r2";
import { pushTokenMatches } from "@/lib/session";

// Product photo folders in R2, for the driftae-ops server token only (owner 2026-11-17: folder names like
// "…-RMB 518" showed our cost in public photo URLs, so they move to clean names). list / copy / delete one key.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = await request.json().catch(() => ({}));
  const key = (v: unknown) => (typeof v === "string" && v && !v.startsWith("/") && !v.includes("..") ? v : null);
  if (b.action === "list") {
    const keys = await listKeys(typeof b.prefix === "string" ? b.prefix : "");
    return keys ? NextResponse.json({ keys }) : NextResponse.json({ error: "R2 list failed" }, { status: 502 });
  }
  if (b.action === "copy" && key(b.from) && key(b.to)) {
    return (await copyObject(b.from, b.to)) ? NextResponse.json({ success: true }) : NextResponse.json({ error: "copy failed" }, { status: 502 });
  }
  if (b.action === "delete" && key(b.key)) {
    return (await deleteObject(b.key)) ? NextResponse.json({ success: true }) : NextResponse.json({ error: "delete failed" }, { status: 502 });
  }
  return NextResponse.json({ error: "action list|copy|delete" }, { status: 400 });
}
