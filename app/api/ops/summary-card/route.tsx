import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { getKvClient } from "@/lib/kv";
import { loadBooks, loadStockReport } from "@/lib/books-server";
import { nzDate } from "@/lib/stock";
import { loadMarketReport, loadProducts } from "@/lib/market-server";
import type { AdRace } from "@/lib/ad-race";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// 运营总览 (owner 2026-10-27; 2026-11-03 "一张图看全"): one long PNG for WeChat with sales, ads (the race), Trade Me,
// watchers per car and family, prices against the market, the new-release radar, search ranks, stock, customers waiting
// and codes waiting. Car names wrap to two lines instead of being cut. The everyday phrases and approval words moved to
// the 「能做什么」 card (/api/team/card), which is where people ask for them.
// Two pictures (owner 2026-11-03 "能不能配车的照片…分两张图，看车名我看不懂"): ?part=business (to-dos, sales, ads, search
// ranks, stock, who waits) and ?part=cars, where every car row shows its photo (Trade Me's first photo, from the snapshot,
// or the catalogue photo for the price rows). Sales and stock come from the books themselves; ads, Trade Me, the inbox
// and pending codes from the ops snapshot driftae-ops pushes every 30 min (`dt dashboard --push`). `dt ops card` saves
// it, the bot sends it; the 07:30 daily check sends it too. Nothing here is computed twice: the same sources as the pages.
export const dynamic = "force-dynamic";

type CarRef = { label?: string; product?: string | null; photo?: string | null };
type Brief = CarRef & { listing_id: number; title: string; price: number | null; views: number; watchers: number };
type Snap = {
  built?: string;
  ads?: { ad: string; window: string; status: string; spend: number; conversations: number; impressions: number }[];
  ad_race?: AdRace;
  inbox?: { status: string }[];
  tm_summary?: {
    live: number; new_views: number; new_watchers: number; top_watched: Brief[];
    new: (CarRef & { title: string; days_live: number; views: number; watchers: number })[];
    slow: (CarRef & { title: string; days_on_trademe: number; views: number })[]; ending_7d_no_watchers: number;
    // from `trademe stats` (listings.json): live listings with the most watchers, and 7-day views/watchers per car family
    watch_top?: (CarRef & { title: string; views: number; watchers: number; watch_rate_pct: number | null })[];
    families?: { label: string; listings: number; new_views: number; new_watchers: number; watch_rate_pct: number | null }[];
  };
  // `dt dashboard`: the latest search-rank measurement vs the one before (trademe/ranks), counted by dt
  tm_ranks?: { measured: string; compared_with: string | null; depth: number; words: number; top10: number; top50: number; out: number;
    moved: { q: string; now: number | null; was: number | null; up: number; car: string | null }[];
    off_trademe?: string[];   // words whose car wasn't on Trade Me when measured (ended, not relisted yet): not a drop
    best: { q: string; rank: number; car: string | null }[] } | null;
  pending_codes?: { verb: string; what: string; to: string; hours_left: number }[];
};

const W = 1080, PAD = 44, MAX_H = 6000;   // WeChat squashes taller images until they can't be read
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", red: "#e86060", amber: "#f3ba4e", line: "#2a2f39" };
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
const nzTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
}

type Kpi = [string, string, string?];
type Line = [string, string?, (string | null)?, string?];   // left, right, photo, second line under the left text
// photos only from where our cars' photos live (Trade Me's CDN, our R2 bucket), as /api/trademe/listing-card
const photoOk = (u?: string | null) => !!u && (/^https:\/\/([\w-]+\.)*(tmcdn\.co\.nz|r2\.dev)\//.test(u) || u.startsWith("data:image/"));
const PHOTO_W = 96, PHOTO_H = 72, ROW_PHOTO = 84;
type Block = { title: string; kpis: Kpi[]; lines: Line[]; empty?: string; note?: string; cut?: number };

// A row's left text wraps (up to two lines) instead of being cut; the card's height has to be known up front, so the
// rows are measured roughly: CJK and full-width ≈ 1 em, Latin ≈ 0.6 em (a little generous, so a row never wraps unplanned) at 21px, inside 1080 − margins − the right text.
const FS = 21, ROW1 = 40, ROW_EXTRA = 28;
const ems = (t: string) => Array.from(t).reduce((n, ch) => n + (ch.charCodeAt(0) > 0x2e7f ? 1 : 0.6), 0);
const leftEms = (right?: string, photo?: boolean) =>
  (W - 2 * PAD - 48 - (right ? ems(right) * FS + 16 : 0) - (photo ? PHOTO_W + 14 : 0)) / FS;
function wrap([l, r, p, sub]: Line): Line {
  // with a second line the name gets one line only
  const ph = photoOk(p) ? p : null, room = leftEms(r, !!ph) * (sub ? 0.95 : 1.8);
  if (ems(l) <= room) return [l, r, ph, sub];
  let out = "", n = 0;
  for (const ch of Array.from(l)) { n += ems(ch); if (n > room) break; out += ch; }
  return [out + "…", r, ph, sub];
}
const rowH = ([l, r, p, sub]: Line) => (sub ? ROW_PHOTO + 6 : p ? ROW_PHOTO : ems(l) > leftEms(r) * 0.9 ? ROW1 + ROW_EXTRA : ROW1);
const carName = (c: CarRef & { title: string }) => c.label || c.title;

// A photo that can't be fetched would fail the whole picture, so every photo is fetched first (a few seconds at most) and
// passed in as data; a row whose photo didn't come back just has no photo.
async function inline(url: string): Promise<string | null> {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (driftae-ledger)" }, signal: AbortSignal.timeout(6000) });
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !/^image\/(jpeg|png)/.test(type)) return null;
    return `data:${type.split(";")[0]};base64,${Buffer.from(await r.arrayBuffer()).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const part = request.nextUrl.searchParams.get("part") === "cars" ? "cars" : "business";
  const [books, stock, snap, market, catalogue] = await Promise.all([loadBooks(), loadStockReport(), getKvClient().get("ops:metrics"),
    loadMarketReport().catch(() => null), loadProducts().catch(() => [])]);
  const imageOf = new Map(catalogue.map((p) => [p.id, p.image ?? null]));
  // 进货价 / 售价 / 毛利 per live car (owner 2026-11-05): the market report's own numbers for the listing's product —
  // cost = the entered 进货价 (catalog_costs) at today's rate, margin = the report's estimate (after its freight guess).
  // No entered cost, or the listing isn't one of our catalogue products: 成本缺, never a guess.
  const priceOf = new Map((market?.products ?? []).map((p) => [p.product, p]));
  const money0 = (n: number) => `$${Math.round(n)}`;
  const costLine = (product?: string | null) => {
    const p = product ? priceOf.get(product) : undefined;
    const sale = p?.our_price != null ? `售价 ${money0(p.our_price)}` : null;
    if (!p || p.cost_cny == null || p.goods_cost_nzd == null) return ["成本缺", sale].filter(Boolean).join(" · ");
    return [`进货 ${money0(p.goods_cost_nzd)}`, sale, p.margin_est_nzd != null ? `毛利 ${money0(p.margin_est_nzd)}` : null].filter(Boolean).join(" · ");
  };
  const s = (snap ?? {}) as Snap;
  const now = new Date();
  const today = nzDate(now), month = today.slice(0, 7);
  const weekAgo = nzDate(new Date(now.getTime() - 7 * 86400000));

  // 销售
  const m = books.months.find((x) => x.month === month);
  const sold7 = books.lines.filter((l) => l.dateSold >= weekAgo && !l.returned).sort((a, b) => b.dateSold.localeCompare(a.dateSold));
  const missing = books.lines.filter((l) => !l.complete && !l.returned);
  const flagged = books.lines.filter((l) => l.flags.length);
  const sales: Block = { title: "销售", kpis: [["本月营收", money(m?.revenue ?? 0)], ["本月单数", `${m?.orders ?? 0}`],
      ["本月已算清毛利", money(m?.completeGp ?? 0), C.green], ["缺成本的单", `${missing.length}`, missing.length ? C.amber : undefined]],
    lines: sold7.slice(0, 5).map((l) => [`${l.dateSold.slice(5)} ${l.model}`, money(l.price + l.shipping)] as Line),
    empty: "近 7 天没有新卖出的" };

  // 广告（近 7 天）
  const ads7 = (s.ads ?? []).filter((a) => a.window !== "lifetime");
  const spend = ads7.reduce((t, a) => t + (a.spend || 0), 0), conv = ads7.reduce((t, a) => t + (a.conversations || 0), 0);
  const live = (s.ads ?? []).filter((a) => a.window === "lifetime" && a.status === "ACTIVE").length;
  const lead = s.ad_race?.ads?.find((r) => r.ad === s.ad_race?.leader);
  const ads: Block = { title: "广告（近 7 天）", kpis: [["花费", `$${spend.toFixed(2)}`], ["私信对话", `${conv}`],
      ["每个对话", conv ? `$${(spend / conv).toFixed(2)}` : "—"], ["在投", `${live} 条`, live ? C.green : C.amber]],
    lines: (s.ad_race?.ads ?? []).slice(0, 5).map((r) => [`${r.ad === s.ad_race?.leader ? "领先 " : ""}${r.name || r.ad}`,
      `${r.done ? "跑满" : `第 ${r.days}/${s.ad_race?.days} 天`} · $${r.spend.toFixed(2)} · 对话 ${r.conversations}` +
      (r.cost_per_conversation != null ? ` · 每对话 $${r.cost_per_conversation.toFixed(2)}` : "")] as Line),
    empty: "赛马还没有数据（每条要跑满 7 天、展示过 1,000 才比）",
    note: lead || !(s.ad_race?.ads ?? []).length ? undefined : "赛马还没有能比的（每条要跑满 7 天、展示过 1,000）" };

  // Trade Me
  const tm = s.tm_summary;
  const trademe: Block = { title: "Trade Me", kpis: tm ? [["在架", `${tm.live} 件`], ["7 天新浏览", `${tm.new_views}`], ["7 天新关注", `${tm.new_watchers}`, C.green],
      ["快到期没人关注", `${tm.ending_7d_no_watchers}`, tm.ending_7d_no_watchers ? C.amber : undefined]] : [],
    lines: tm ? [
      ...tm.new.slice(0, 3).map((n) => [`新上架 ${carName(n)}`, `${n.days_live} 天 · 浏览 ${n.views} · 关注 ${n.watchers}`, n.photo] as Line),
      ...tm.slow.slice(0, 2).map((b) => [`没人关注 ${carName(b)}`, `${b.days_on_trademe} 天 · 浏览 ${b.views}`, b.photo] as Line),
    ] : [], empty: "Trade Me 数据还没推过来" };

  // 关注量 / 车系: the numbers `trademe stats` wrote into the snapshot (listings.json), shown as they are
  const pctText = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
  // every live listing (owner 2026-11-03 "trademe 的 33 个没有啊"), most watched first; the snapshot carries all of them
  const watchB: Block = { title: `在架的每一台（${tm?.watch_top?.length ?? 0} 件，按关注排）`, kpis: [],
    lines: tm ? (tm.watch_top ?? []).map((b) => [carName(b), `浏览 ${b.views} · 关注 ${b.watchers} · 收藏率 ${pctText(b.watch_rate_pct)}`, b.photo,
      costLine(b.product)] as Line) : [],
    empty: "关注量数据还没推过来" };
  const famB: Block = { title: "车系（近 7 天）", kpis: [],
    lines: tm ? (tm.families ?? []).map((f) => [`${f.label}（${f.listings} 件）`, `浏览 ${f.new_views} · 关注 ${f.new_watchers} · 收藏率 ${pctText(f.watch_rate_pct)}`] as Line) : [],
    empty: "关注量数据还没推过来" };

  // 比价: the market report's own numbers (our price, cheapest same-car price, % apart), biggest gap first
  const priced = (market?.products ?? []).filter((p) => p.our_price != null && p.market && p.vs_market_pct != null)
    .sort((a, b) => Math.abs(b.vs_market_pct as number) - Math.abs(a.vs_market_pct as number)).slice(0, 8);
  // until refs are confirmed there is no same-car price: show Bay Hobbies' same-casting price (another colour) as a
  // reference instead, clearly labelled, with how many refs still need checking on /market
  const signed = (v: number) => `${v > 0 ? "+" : ""}${v}%`;
  const similar = priced.length ? [] : (market?.products ?? [])
    .filter((p) => p.our_price != null && p.bayhobbies?.match === "model" && p.vs_bayhobbies_pct != null)
    .sort((a, b) => Math.abs(b.vs_bayhobbies_pct as number) - Math.abs(a.vs_bayhobbies_pct as number)).slice(0, 6);
  const refs = market?.refs;
  const priceB: Block = { title: "比价：我们价 vs 同款市场价（Bay Hobbies / Trade Me）",
    kpis: refs ? [["货号已确认", `${refs.confirmed} 台`, refs.confirmed ? C.green : C.amber], ["待核对", `${refs.candidate} 台`, refs.candidate ? C.amber : undefined],
      ["不知道货号", `${refs.unknown} 台`], ["Bay Hobbies 数据", market?.bayhobbies_seen ? nzTime(market.bayhobbies_seen).split(" ")[0] : "—"]] : [],
    lines: priced.length
      ? priced.map((p) => [p.name, `我们 ${money(p.our_price as number)} · ${p.market?.source} ${money(p.market?.price ?? 0)} · ${signed(p.vs_market_pct as number)}`, imageOf.get(p.product)] as Line)
      : similar.map((p) => [`同车型参考 ${p.name}`, `我们 ${money(p.our_price as number)} · BH 别色 ${money(p.bayhobbies?.price ?? 0)} · ${signed(p.vs_bayhobbies_pct as number)}`, imageOf.get(p.product)] as Line),
    empty: market ? "还没有能比的价" : "无数据（市场模块没读到）",
    note: priced.length ? undefined : "货号确认后才算同款比价，在账本「市场」页确认。" };

  // 新品雷达: the candidates on /market, not dropped, in the report's own order
  const radar = (market?.radar ?? []).filter((c) => c.status !== "dropped");
  const radarB: Block = { title: "新品雷达", kpis: market ? [["候选", `${radar.filter((c) => c.status === "proposed").length} 台`],
      ["要", `${radar.filter((c) => c.status === "kept").length} 台`, C.green]] : [],
    lines: radar.slice(0, 5).map((c) => [`${c.status === "kept" ? "要 " : ""}${c.brand} ${c.name}`,
      [c.release ? `预计 ${c.release}` : null, c.margin_est_nzd != null ? `估毛利 ${money(c.margin_est_nzd)}` : null].filter(Boolean).join(" · ")] as Line),
    empty: market ? "雷达上没有候选" : "无数据（市场模块没读到）" };

  // 搜索排名: dt's daily measurement (Trade Me best match), counted by dt
  const rk = s.tm_ranks;
  const place = (r: number | null) => (r == null ? `${rk?.depth ?? 200} 名外` : `第 ${r} 名`);
  const rankB: Block = { title: "Trade Me 搜索排名" + (rk ? `（${nzTime(rk.measured)}${rk.compared_with ? ` 比 ${rk.compared_with.slice(5)}` : ""}）` : ""),
    kpis: rk ? [["搜索词", `${rk.words}`], ["前 10 名", `${rk.top10}`, C.green], ["前 50 名", `${rk.top50}`], [`${rk.depth} 名外`, `${rk.out}`, rk.out ? C.amber : undefined]] : [],
    lines: rk ? (rk.moved.length
      ? rk.moved.map((m) => [`${m.up > 0 ? "↑" : "↓"} 「${m.q}」${m.car ? ` ${m.car}` : ""}`, `${place(m.was)} → ${place(m.now)}`] as Line)
      : rk.best.map((b) => [`「${b.q}」${b.car ? ` ${b.car}` : ""}`, place(b.rank)] as Line))
      .concat(rk.off_trademe?.length ? [[`车不在架上、搜不到（到期还没重新上架）：${rk.off_trademe.map((q) => `「${q}」`).join("")}`] as Line] : []) : [],
    empty: "无数据（排名还没推过来）", note: rk && rk.moved.length ? "↑↓ 是车在架上、名次真的变了的词；每个词的名次看「排名」卡。" : undefined };

  // 库存
  const spare = stock.items.filter((i) => i.status === "InStock" && !i.listingId);
  const stockB: Block = { title: "库存", kpis: [["在库（含已上架、在途）", `${stock.totals.inStock} 台`], ["落地成本", money(stock.totals.stockCost)],
      ["已上架", `${stock.totals.listed} 台`], ["在库没上架", `${spare.length} 台`, spare.length ? C.amber : undefined]],
    lines: spare.slice(0, 3).map((i) => [`没上架 ${i.model}`, i.landedCost ? money(i.landedCost) : "成本缺"] as Line) };

  // 客人和审批
  const waitingCustomers = (s.inbox ?? []).filter((c) => c.status === "waiting").length;
  const codes = s.pending_codes ?? [];
  const people: Block = { title: "客人和审批", kpis: [["等回复的客人", `${waitingCustomers}`, waitingCustomers ? C.red : C.green],
      ["等码的卡", `${codes.length}`, codes.length ? C.amber : C.green], ["账本要核对", `${flagged.length} 单`, flagged.length ? C.amber : undefined]],
    lines: codes.slice(0, 4).map((c) => [`等「${c.verb}」${c.what}`, `还剩 ${c.hours_left} 小时`] as Line) };

  // 一句话结论
  const todo = [waitingCustomers && `${waitingCustomers} 位客人等回复`, codes.length && `${codes.length} 张卡等码`,
    missing.length && `${missing.length} 单缺成本`, tm?.ending_7d_no_watchers && `${tm.ending_7d_no_watchers} 件快到期没人关注`].filter(Boolean) as string[];
  const verdict = todo.length ? `要人处理：${todo.join(" · ")}` : "今天没有等人处理的事";

  const blocks = part === "cars" ? [trademe, watchB, famB, priceB, radarB] : [sales, ads, rankB, stockB, people];
  for (const b of blocks) b.lines = b.lines.map(wrap);
  const photos = new Map<string, string | null>();
  const wanted = Array.from(new Set(blocks.flatMap((b) => b.lines.map((l) => l[2]).filter((u): u is string => !!u))));
  await Promise.all(wanted.map(async (u) => photos.set(u, await inline(u))));
  for (const b of blocks) b.lines = b.lines.map(([l, r, p, sub]) => wrap([l, r, p ? photos.get(p) ?? null : null, sub]));
  const blockH = (b: Block) => 56 + (b.kpis.length ? 112 : 0) + (b.lines.length ? b.lines.reduce((h, l) => h + rowH(l), 0) : b.empty ? ROW1 : 0)
    + (b.note ? 34 : 0) + 36;
  const height = () => PAD + 100 + 90 + blocks.reduce((h, b) => h + blockH(b) + 20, 0) + 80 + PAD;
  // over the WeChat limit: drop rows from the longest block first (details stay on the pages)
  while (height() > MAX_H) {
    const b = blocks.reduce((x, y) => (y.lines.length > x.lines.length ? y : x));
    if (b.lines.length <= 3) break;
    b.lines = b.lines.slice(0, -1);
    b.cut = (b.cut ?? 0) + 1;
    b.note = `还有 ${b.cut} 件放不下（图太长微信会压糊），在账本「运营」页看全。`;
  }
  const H = height();

  const title = part === "cars" ? "DRIFTAE 运营总览 ② 车" : "DRIFTAE 运营总览 ① 生意";
  const sub = `截至 ${nzTime(now.toISOString())}` + (s.built ? ` · 广告/Trade Me 数据 ${nzTime(s.built)}` : "");
  const footer = part === "cars"
    ? "数字和账本网页一样：Trade Me 和关注量看「运营」，比价和雷达看「市场」。照片是 Trade Me 刊登的第一张（比价用网站的主图）。"
    : "数字和账本网页一样：销售看「账本」，库存看「库存」，广告和排名看「运营」。车的表现在第 ② 张。常用问法和审批口令：跟 bot 说「能做什么」。";
  const allText = [title, sub, verdict, footer,
    ...blocks.flatMap((b) => [b.title, b.empty ?? "", b.note ?? "", ...b.kpis.flatMap((k) => [k[0], k[1]]), ...b.lines.flatMap((l) => [l[0], l[1] ?? "", l[3] ?? ""])]),
    "0123456789$.,%−—·（）/：…「」+↑↓→ "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "18px 24px" };

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 100 }}>
          <div style={{ fontSize: 46, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ ...box, height: 90, justifyContent: "center", fontSize: 28, fontWeight: 700, color: todo.length ? C.amber : C.green }}>{verdict}</div>
        {blocks.map((b) => (
          <div key={b.title} style={{ ...box, marginTop: 20 }}>
            <div style={{ fontSize: 28, fontWeight: 700, height: 44 }}>{b.title}</div>
            {b.kpis.length > 0 && (
              <div style={{ display: "flex", gap: 12, height: 100, marginBottom: 12 }}>
                {b.kpis.map(([label, value, color]) => (
                  <div key={label} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", background: C.bg, borderRadius: 12, padding: "0 16px" }}>
                    <div style={{ fontSize: 17, color: C.muted }}>{label}</div>
                    <div style={{ fontSize: 32, fontWeight: 700, color: color ?? C.text, marginTop: 4 }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
            {b.lines.map(([l, r, p, sub], i) => (
              <div key={i} style={{ display: "flex", height: rowH([l, r, p, sub]), alignItems: "center", fontSize: FS, lineHeight: `${ROW_EXTRA}px`, borderTop: `1px solid ${C.line}` }}>
                {p ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p} width={PHOTO_W} height={PHOTO_H} style={{ objectFit: "cover", borderRadius: 8, marginRight: 14 }} alt="" />
                ) : null}
                {sub ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                    <div style={{ display: "flex" }}>{l}</div>
                    <div style={{ display: "flex", fontSize: 19, color: sub.startsWith("成本缺") ? C.amber : C.green, marginTop: 2 }}>{sub}</div>
                  </div>
                ) : <div style={{ flex: 1, display: "flex" }}>{l}</div>}
                {r ? <div style={{ color: C.muted, marginLeft: 16, whiteSpace: "nowrap" }}>{r}</div> : null}
              </div>
            ))}
            {!b.lines.length && b.empty ? <div style={{ fontSize: 20, color: C.muted, height: ROW1, display: "flex", alignItems: "center" }}>{b.empty}</div> : null}
            {b.note ? <div style={{ fontSize: 18, color: C.muted, height: 34, display: "flex", alignItems: "flex-end" }}>{b.note}</div> : null}
          </div>
        ))}
        <div style={{ fontSize: 18, color: C.muted, marginTop: 20, lineHeight: 1.5 }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
