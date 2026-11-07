import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { getKvClient } from "@/lib/kv";
import { loadBooks } from "@/lib/books-server";
import { loadMarketReport } from "@/lib/market-server";
import { FREIGHT_EST_NZD } from "@/lib/market";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// 总览 (owner 2026-11-07: 一个图解决一个问题，总览就是整体的利润情况): ?part=business is one thing, the profit of all time from
// the books, with ad money as one cost. Sales, ad detail, ranks, stock and who's waiting are their own cards.
// ?part=cars (在售) is every live car with its photo (Trade Me's first photo, from the snapshot). Ads and Trade Me come from the
// ops snapshot driftae-ops pushes every 30 min (`dt dashboard --push`). `dt ops card` saves it, the bot sends it.
export const dynamic = "force-dynamic";

type CarRef = { label?: string; product?: string | null; photo?: string | null };
type Brief = CarRef & { listing_id: number; title: string; price: number | null; views: number; watchers: number };
type Snap = {
  built?: string;
  ads?: { ad: string; window: string; status: string; spend: number; conversations: number; impressions: number }[];
  tm_summary?: {
    live: number; new_views: number; new_watchers: number; top_watched: Brief[];
    new: (CarRef & { title: string; days_live: number; views: number; watchers: number })[];
    slow: (CarRef & { title: string; days_on_trademe: number; views: number })[]; ending_7d_no_watchers: number;
    // from `trademe stats` (listings.json): live listings with the most watchers, and 7-day views/watchers per car family
    watch_top?: (CarRef & { title: string; price?: number | null; views: number; watchers: number; watch_rate_pct: number | null })[];
    families?: { label: string; listings: number; new_views: number; new_watchers: number; watch_rate_pct: number | null }[];
  };
};

const W = 1080, PAD = 44, MAX_H = 12000;   // dt cuts the card into small pictures for WeChat, so this only guards rendering (6000 dropped 14 of 46 cars)
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
  const [books, snap, market] = await Promise.all([loadBooks(), getKvClient().get("ops:metrics"),
    part === "cars" ? loadMarketReport().catch(() => null) : null]);
  // 进货价 / 售价 / 毛利 per live car (owner 2026-11-05): the market report's own numbers for the listing's product —
  // cost = the report's goods cost (entered 进货价, else the RMB in the photo folder name) at today's rate, margin = the
  // report's estimate (after its freight guess). Neither, or the listing isn't one of our catalogue products: 成本缺.
  const priceOf = new Map((market?.products ?? []).map((p) => [p.product, p] as const));
  const money0 = (n: number) => `$${Math.round(n)}`;
  // 售价 = what the listing really asks (the report's our_price misses relisted cars); margin = that − cost − the report's freight guess
  const costLine = (product?: string | null, listed?: number | null) => {
    const p = product ? priceOf.get(product) : undefined;
    const price = listed ?? p?.our_price ?? null;
    const sale = price != null ? `售价 ${money0(price)}` : null;
    if (!p || p.goods_cost_nzd == null) return ["成本缺", sale].filter(Boolean).join(" · ");
    return [`进货 ${money0(p.goods_cost_nzd)}`, sale, price != null ? `毛利 ${money0(price - p.goods_cost_nzd - FREIGHT_EST_NZD)}` : null].filter(Boolean).join(" · ");
  };
  const s = (snap ?? {}) as Snap;
  const now = new Date();

  // 利润表, all time: only sales whose costs are all in have a real profit, so the others are shown apart and not counted.
  // Ad money is every ad's whole history; none of it is left out for the sales not counted yet, so the profit is on the low side.
  const sum = (ls: typeof books.lines, f: (l: (typeof books.lines)[number]) => number) => ls.reduce((t, l) => t + f(l), 0);
  const done = books.lines.filter((l) => l.complete), open = books.lines.filter((l) => !l.complete);
  const adSpend = (s.ads ?? []).filter((a) => a.window === "lifetime").reduce((t, a) => t + (a.spend || 0), 0);
  const profit = books.totals.completeGp - adSpend;
  const first = books.lines.map((l) => l.dateSold).filter(Boolean).sort()[0];
  const profitB: Block = { title: `利润表（${first ? `${first.slice(0, 10)} 第一单起，` : ""}算清的 ${done.length} 单）`, kpis: [], lines: [
    ["收入（售价 + 收的运费）", money(books.totals.completeRevenue)],
    ["车的进货价", money(-sum(done, (l) => l.purchase))],
    ["空运费", money(-sum(done, (l) => l.air))],
    ["快递费", money(-sum(done, (l) => l.courier))],
    ["Trade Me 费用", money(-sum(done, (l) => l.fee))],
    ["广告费", money(-adSpend)],
    ["利润", money(profit)],
  ] };
  const openB: Block = { title: "还没算进去", kpis: [], lines: open.length
    ? [[`${open.length} 单成本没填完（收入 ${money(sum(open, (l) => l.price + l.shipping))}）`, "填完利润才准"]] : [],
    empty: "每一单的成本都填完了" };

  // Trade Me
  const tm = s.tm_summary;
  const trademe: Block = { title: "Trade Me", kpis: tm ? [["在架", `${tm.live} 件`], ["7 天新浏览", `${tm.new_views}`], ["7 天新关注", `${tm.new_watchers}`, C.green],
      ["快到期没人关注", `${tm.ending_7d_no_watchers}`, tm.ending_7d_no_watchers ? C.amber : undefined]] : [],
    lines: [], empty: tm ? undefined : "Trade Me 数据还没推过来" };

  // 关注量: the numbers `trademe stats` wrote into the snapshot (listings.json), shown as they are
  const pctText = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
  // every live listing (owner 2026-11-03 "trademe 的 33 个没有啊"), most watched first; the snapshot carries all of them
  const watchB: Block = { title: `在架的每一台（${tm?.watch_top?.length ?? 0} 件，按关注排）`, kpis: [],
    lines: tm ? (tm.watch_top ?? []).map((b) => [carName(b), `浏览 ${b.views} · 关注 ${b.watchers} · 收藏率 ${pctText(b.watch_rate_pct)}`, b.photo,
      costLine(b.product, b.price)] as Line) : [],
    empty: "关注量数据还没推过来" };
  // 进货价还缺哪些 (owner 2026-11-05 "你记着总览车图都标里面"): every catalogue car without an entered 进货价, so the
  // gap shrinks on the picture as the team fills it (bot: 「<车> 进货价 ¥N」, or the 商品与价格 page)
  const noCost = (market?.products ?? []).filter((p) => p.cost_cny == null);
  const costB: Block = { title: "进货价还缺哪些", kpis: market ? [["已填", `${(market.products.length - noCost.length)} 台`, C.green],
      ["还缺", `${noCost.length} 台`, noCost.length ? C.amber : C.green]] : [],
    // names only, three to a row: the cars picture is already near WeChat's height limit
    lines: Array.from({ length: Math.ceil(noCost.length / 3) }, (_, i) => [noCost.slice(i * 3, i * 3 + 3)
      .map((p) => p.name.replace(/^(NOREV|Sun Star|KK Scale|WERK83|Quartzo)\s+/i, "")).join("  ·  ")] as Line),
    empty: market ? "全部都有进货价了" : "无数据（市场模块没读到）",
    note: noCost.length ? "补：跟 bot 说「车名 进货价 ¥N」，或发进货单照片" : undefined };
  const carTodo = tm?.ending_7d_no_watchers ? [`${tm.ending_7d_no_watchers} 件快到期没人关注`] : [];
  const verdict = part === "cars" ? (carTodo.length ? `要人处理：${carTodo[0]}` : "在售的车今天没有要处理的")
    : `到现在一共${profit < 0 ? "亏" : "赚"} ${money(Math.abs(profit))}`;
  const verdictColor = part === "cars" ? (carTodo.length ? C.amber : C.green) : profit < 0 ? C.red : C.green;

  // one command, one set of pictures (owner 2026-11-06): 比价, 新品, 哪类车好卖, 新上架 and 没人关注 are their own cards
  const blocks = part === "cars" ? [trademe, watchB, costB] : [profitB, openB];
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
    b.note = `还有 ${b.cut} 件放不下，在账本「运营」页看全。`;
  }
  const H = height();

  const title = part === "cars" ? "DRIFTAE 在售" : "DRIFTAE 总览";
  const sub = `截至 ${nzTime(now.toISOString())}` + (s.built ? ` · 广告/Trade Me 数据 ${nzTime(s.built)}` : "");
  const footer = part === "cars"
    ? "数字和账本网页一样，看「运营」。照片是 Trade Me 刊登的第一张。比价、该进什么车、新上架怎么样、没人关注：各问各的。"
    : "这张只看利润。其他的各问各的：账本、广告、库存、排名、分账、在售。全部指令：说「指令」。";
  const allText = [title, sub, verdict, footer,
    ...blocks.flatMap((b) => [b.title, b.empty ?? "", b.note ?? "", ...b.kpis.flatMap((k) => [k[0], k[1]]), ...b.lines.flatMap((l) => [l[0], l[1] ?? "", l[3] ?? ""])]),
    "0123456789$.,%−—·（）/：…「」+ "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "18px 24px" };

  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 100 }}>
          <div style={{ fontSize: 46, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ ...box, height: 90, justifyContent: "center", fontSize: part === "cars" ? 28 : 44, fontWeight: 700, color: verdictColor }}>{verdict}</div>
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
