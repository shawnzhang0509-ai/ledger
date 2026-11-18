import { NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";

// Pinterest catalog's product file (owner 2026-11-18): the same rows as /feed/google.tsv, which the driftae-ops server
// pushes every 30 min. Pinterest's availability takes only "in stock" / "out of stock" / "preorder", so our
// "backorder" (ordered in for each buyer) becomes "preorder", and the columns Pinterest doesn't use are dropped.
export const dynamic = "force-dynamic";

const DROP = new Set(["availability_date", "identifier_exists"]);

export async function GET() {
  const tsv = await getKvClient().get<string>("merchant:google-feed");
  if (!tsv) return new NextResponse("not built yet", { status: 404 });
  const [head, ...rows] = tsv.trim().split("\n").map((l) => l.split("\t"));
  const keep = head.map((h, i) => (DROP.has(h) ? -1 : i)).filter((i) => i >= 0);
  const avail = head.indexOf("availability");
  const out = [head, ...rows.map((r) => r.map((v, i) => (i === avail && v === "backorder" ? "preorder" : v)))]
    .map((r) => keep.map((i) => r[i] ?? "").join("\t"))
    .join("\n");
  return new NextResponse(out + "\n", { headers: { "Content-Type": "text/tab-separated-values; charset=utf-8", "Cache-Control": "no-store" } });
}
