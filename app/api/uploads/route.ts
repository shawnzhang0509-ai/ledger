import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { addPhoto, listDeletedPhotos, listPhotos, markPhotoDeleted } from "@/lib/db";
import { deleteObject, presignedPut, publicUrl, r2Config } from "@/lib/r2";
import { pushTokenMatches, sessionRole } from "@/lib/session";

const MAX_SIDE = 4096;

// GET: the team sees recent uploads; the driftae-ops server (Bearer METRICS_PUSH_TOKEN) fetches new ones (?after=id).
export async function GET(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  if (!server && !sessionRole(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;
  const deletedSince = params.get("deleted_since");
  if (server && deletedSince) {
    return NextResponse.json(await listDeletedPhotos(deletedSince));
  }
  const after = Number(params.get("after") ?? 0) || 0;
  return NextResponse.json(await listPhotos(after, server ? 500 : 60));
}

// DELETE ?id=…: anyone logged in may remove a photo — the file leaves R2, the row is marked deleted.
export async function DELETE(request: NextRequest) {
  if (!sessionRole(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Bad id" }, { status: 400 });
  const key = await markPhotoDeleted(id);
  if (!key) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const removed = await deleteObject(key);
  return NextResponse.json({ success: true, removedFromStorage: removed });
}

// POST {action: "presign"} → a 10-minute URL to PUT one JPEG into R2 under uploads/.
// POST {action: "complete", key, ...} → record it once the browser's (or the server's) PUT succeeded.
// The driftae-ops server (Bearer METRICS_PUSH_TOKEN) uploads photos sent to a team member's WeChat bot;
// it names whose bot in uploadedBy, recorded as "bot:<name>".
export async function POST(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  const role = server ? null : sessionRole(request);
  if (!server && !role) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
                     note: str(body.note, 300), width, height,
                     uploaded_by: role ?? `bot:${str(body.uploadedBy, 40)?.replace(/[^\w-]/g, "") || "server"}` });
    return NextResponse.json({ success: true, url: publicUrl(key) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
