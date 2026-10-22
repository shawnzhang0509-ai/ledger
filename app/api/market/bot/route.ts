import { NextRequest, NextResponse } from "next/server";
import { addPrice, addRadar, addRef, loadMarketRows, replaceSeen, setPriceStatus, setRadar } from "@/lib/market-db";
import { pushTokenMatches, sessionRole } from "@/lib/session";

// Writes to the market records, from the bots (driftae-ops `dt market …`, Bearer METRICS_PUSH_TOKEN, `by` = who asked)
// and from the /market page (signed in: the three of them have the same rights). Refs are a new row per change, so
// the history stays; prices and radar candidates are added once and then only checked (confirm/reject, 要/不要, 进货价).
export const dynamic = "force-dynamic";

const s = (v: unknown, n = 200) => (typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null);
const num = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const ID = /^[\w-]{1,120}$/;
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(request: NextRequest) {
  const server = pushTokenMatches(request.headers.get("authorization"));
  const role = server ? null : sessionRole(request);
  if (!server && !role) return bad("Unauthorized", 401);
  const b = await request.json().catch(() => null);
  if (!b || typeof b !== "object") return bad("Bad body");
  const by = server ? `bot:${(s(b.by, 40) ?? "server").replace(/[^\w一-鿿-]/g, "")}` : `page:${role}`;

  switch (b.action) {
    case "ref": {
      const status = ["confirmed", "candidate", "unknown"].includes(b.status) ? b.status : null;
      const ref = s(b.ref, 20);
      if (!ID.test(String(b.product_id ?? "")) || !status) return bad("Need product_id and status confirmed|candidate|unknown");
      if (status !== "unknown" && !(ref && /^[A-Za-z0-9-]{3,20}$/.test(ref))) return bad("A ref is 3-20 letters/digits");
      await addRef({ product_id: b.product_id, brand: s(b.brand, 60), ref: status === "unknown" ? null : ref, colour: s(b.colour, 60),
        status, confidence: s(b.confidence, 20), sources: Array.isArray(b.sources) ? b.sources.map((x: unknown) => s(x, 500)).filter(Boolean) : [],
        note: s(b.note, 500), by });
      return NextResponse.json({ success: true });
    }
    case "price": {
      const total = num(b.total_nzd);
      if (!ID.test(String(b.product_id ?? "")) || !s(b.url, 1000) || total == null || total <= 0) return bad("Need product_id, url, total_nzd");
      const id = s(b.id, 20) ?? crypto.randomUUID().slice(0, 8);
      await addPrice({ id, product_id: b.product_id, ref: s(b.ref, 20), source: s(b.source, 80) ?? new URL(b.url).hostname,
        seller: s(b.seller, 80), url: b.url, price: num(b.price), currency: s(b.currency, 3) ?? "NZD", shipping: num(b.shipping),
        nzd_per_unit: num(b.nzd_per_unit), fx_date: s(b.fx_date, 10), total_nzd: total, shipping_known: Boolean(b.shipping_known),
        match: b.match === "ref" ? "ref" : "looks-same", condition: b.condition === "used" ? "used" : "new", note: s(b.note, 500), by,
        at: s(b.at, 40) ?? undefined });
      return NextResponse.json({ success: true, id });
    }
    case "price-status": {
      if (!["confirmed", "rejected"].includes(b.status)) return bad("status confirmed|rejected");
      return (await setPriceStatus(String(b.id ?? ""), b.status, by, s(b.why, 300))) ? NextResponse.json({ success: true }) : bad("No such price", 404);
    }
    case "seen": {
      if (!["bayhobbies", "trademe"].includes(b.source) || !Array.isArray(b.rows) || b.rows.length > 2000) return bad("Need source bayhobbies|trademe and rows");
      const rows = b.rows.map((r: Record<string, unknown>) => ({ key: String(r.key ?? "").slice(0, 200), product_id: s(r.product_id, 120),
        match: r.match === "ref" ? "ref" : r.match === "model" ? "model" : null, title: s(r.title, 300) ?? "", ref: s(r.ref, 20),
        price_nzd: num(r.price_nzd), url: s(r.url, 1000) })).filter((r: { key: string }) => r.key);
      await replaceSeen(b.source, rows);
      return NextResponse.json({ success: true, rows: rows.length });
    }
    case "radar": {
      const ref = s(b.ref, 20), brand = s(b.brand, 60), name = s(b.name, 200), url = s(b.url, 1000);
      if (!ref || !brand || !name || !url) return bad("Need brand, ref, name, url");
      const { refs, radar } = await loadMarketRows();
      const ours = refs.find((r) => r.ref === ref);
      if (ours) return bad(`ref ${ref} is our product ${ours.product_id}`, 409);
      const dup = radar.find((r) => r.ref === ref && r.brand.toLowerCase() === brand.toLowerCase() && r.status !== "dropped");
      if (dup) return bad(`already on the radar: ${dup.id} ${dup.name}`, 409);
      const id = s(b.id, 20) ?? crypto.randomUUID().slice(0, 8);
      await addRadar({ id, brand, ref, name, scale: s(b.scale, 10), colour: s(b.colour, 60), family: s(b.family, 40) ?? "other", url,
        price: num(b.price), currency: s(b.currency, 3), shipping: num(b.shipping), overseas_nzd: num(b.overseas_nzd),
        shipping_known: Boolean(b.shipping_known), release: s(b.release, 40), why: s(b.why, 300), by, at: s(b.at, 40) ?? undefined,
        status: ["proposed", "kept", "dropped"].includes(b.status) ? b.status : undefined });
      return NextResponse.json({ success: true, id });
    }
    case "radar-cost": {
      const cny = num(b.cny);
      if (cny == null || cny <= 0) return bad("Need cny");
      return (await setRadar(String(b.id ?? ""), { supplier_cny: cny, supplier_url: s(b.url, 1000) }, by)) ? NextResponse.json({ success: true }) : bad("No such candidate", 404);
    }
    case "radar-status": {
      if (!["kept", "dropped"].includes(b.status)) return bad("status kept|dropped");
      return (await setRadar(String(b.id ?? ""), { status: b.status, why: s(b.why, 300) }, by)) ? NextResponse.json({ success: true }) : bad("No such candidate", 404);
    }
    default:
      return bad("action: ref | price | price-status | seen | radar | radar-cost | radar-status");
  }
}
