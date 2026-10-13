import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { addPhoto, listPhotos } from "@/lib/db";
import { presignedPut, publicUrl, r2Config } from "@/lib/r2";
import { pushTokenMatches, sessionRole } from "@/lib/session";

const MAX_SIDE = 4096;

// GET: the team sees recent uploads; the driftae-ops server (Bearer METRICS_PUSH_TOKEN) fetches new ones (?after=id).
export async function GET(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  if (!server && !sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const after = Number(new URL(request.url).searchParams.get("after") ?? 0) || 0;
  return NextResponse.json(await listPhotos(after, server ? 500 : 60));
}

// POST {action: "presign"} → a 10-minute URL to PUT one JPEG into R2 under uploads/.
// POST {action: "complete", key, ...} → record it once the browser's PUT succeeded.
export async function POST(request: NextRequest) {
  const role = sessionRole(request);
  if (!role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!r2Config()) return NextResponse.json({ error: "R2 未配置：在 Vercel 加 R2_* 环境变量" }, { status: 500 });
  const body = await request.json().catch(() => ({}));

  if (body.action === "presign") {
    const day = new Date().toISOString().slice(0, 10);
    const product = typeof body.productId === "string" && /^[\w-]{1,120}$/.test(body.productId) ? body.productId : "unsorted";
    const key = `uploads/${day}/${product}/${randomUUID()}.jpg`;
    return NextResponse.json({ key, uploadUrl: presignedPut(key), publicUrl: publicUrl(key) });
  }

  if (body.action === "complete") {
    const key = String(body.key ?? "");
    const width = Number(body.width), height = Number(body.height);
    if (!/^uploads\/\d{4}-\d{2}-\d{2}\/[\w-]{1,120}\/[0-9a-f-]{36}\.jpg$/.test(key)
        || !(width > 0 && width <= MAX_SIDE && height > 0 && height <= MAX_SIDE)) {
      return NextResponse.json({ error: "Bad upload" }, { status: 400 });
    }
    // only record files that really landed in R2
    const head = await fetch(publicUrl(key)!, { method: "HEAD" });
    if (!head.ok) return NextResponse.json({ error: "File not found in R2" }, { status: 400 });
    const str = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
    await addPhoto({ key, url: publicUrl(key)!, product_id: str(body.productId, 120), product_name: str(body.productName, 200),
                     note: str(body.note, 300), width, height, uploaded_by: role });
    return NextResponse.json({ success: true, url: publicUrl(key) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
