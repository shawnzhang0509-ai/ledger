import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { getKvClient } from "@/lib/kv";
import { loadBooks, loadStockReport } from "@/lib/books-server";
import { nzDate } from "@/lib/stock";
import { loadMarketReport } from "@/lib/market-server";
import { RADAR_LABELS } from "@/lib/market";
import type { AdRace } from "@/lib/ad-race";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// 运营总览 (owner 2026-10-27): one long PNG for WeChat with sales, ads, Trade Me, stock, customers waiting, codes waiting
// and the everyday phrases and approval words. Sales and stock come from the books themselves; ads, Trade Me, the inbox
// and pending codes from the ops snapshot driftae-ops pushes every 30 min (`dt dashboard --push`). `dt ops card` saves
// it, the bot sends it; the 07:30 daily check sends it too. Nothing here is computed twice: the same sources as the pages.
export const dynamic = "force-dynamic";

type Brief = { listing_id: number; title: string; price: number | null; views: number; watchers: number };
type Snap = {
  built?: string;
  ads?: { ad: string; window: string; status: string; spend: number; conversations: number; impressions: number }[];
  ad_race?: AdRace;
  inbox?: { status: string }[];
  tm_summary?: {
    live: number; new_views: number; new_watchers: number; watch_rate_pct?: number | null; top_watched: Brief[];
    new: { title: string; days_live: number; views: number; watchers: number }[];
    slow: { title: string; days_on_trademe: number; views: number }[]; ending_7d_no_watchers: number;
    // from `trademe stats` (listings.json): live listings with the most watchers, and 7-day views/watchers per car family
    watch_top?: { title: string; views: number; watchers: number; watch_rate_pct: number | null }[];
    families?: { label: string; listings: number; new_views: number; new_watchers: number; watch_rate_pct: number | null }[];
    // from `trademe rank`: where our best listing comes up in Trade Me's search for each word (null = not in the first `depth`)
    ranks?: { measured: string; depth: number; words: { q: string; best_rank: number | null; car: string | null; previous: number | null }[] } | null;
  };
  pending_codes?: { verb: string; what: string; to: string; hours_left: number }[];
  capabilities?: { items?: { category: string; name: string; say?: string; code?: string }[] };
};

// Owner 2026-11-02: every ledger view in this one picture (sales, ads, Trade Me, watchers per car, car families, prices vs
// market, new-release radar, search ranks, stock, customers and codes), 3-8 rows per block, "无数据" when a block has none;
// width 1080 and never taller than MAX_H (WeChat squeezes taller images until they can't be read).
const W = 1080, PAD = 44, MAX_H = 6000;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", red: "#e86060", amber: "#f3ba4e", line: "#2a2f39" };
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-NZ", { maximumFractionDigits: 0 })}`;
const nzTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const cut = (s: string, n: number) => (Array.from(s).length > n ? Array.from(s).slice(0, n).join("") + "…" : s);

async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
}

type Kpi = [string, string, string?];
type Block = { title: string; kpis: Kpi[]; lines: [string, string?][]; empty?: string };

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const [books, stock, snap, market] = await Promise.all([loadBooks(), loadStockReport(), getKvClient().get("ops:metrics"),
    loadMarketReport().catch(() => null)]);
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
    lines: sold7.slice(0, 5).map((l) => [`${l.dateSold.slice(5)} ${cut(l.model, 34)}`, money(l.price + l.shipping)] as [string, string]),
    empty: "近 7 天没有新卖出的" };

  // 广告（近 7 天）
  const ads7 = (s.ads ?? []).filter((a) => a.window !== "lifetime");
  const spend = ads7.reduce((t, a) => t + (a.spend || 0), 0), conv = ads7.reduce((t, a) => t + (a.conversations || 0), 0);
  const live = (s.ads ?? []).filter((a) => a.window === "lifetime" && a.status === "ACTIVE").length;
  const lead = s.ad_race?.ads?.find((r) => r.ad === s.ad_race?.leader);
  const ads: Block = { title: "广告（近 7 天）", kpis: [["花费", `$${spend.toFixed(2)}`], ["私信对话", `${conv}`],
      ["每个对话", conv ? `$${(spend / conv).toFixed(2)}` : "—"], ["在投", `${live} 条`, live ? C.green : C.amber]],
    lines: lead ? [[`赛马领先：${cut(lead.name || lead.ad, 30)}`, `每对话 $${(lead.cost_per_conversation ?? 0).toFixed(2)}`]] : [],
    empty: "赛马还没有能比的（要跑满 7 天）" };

  // Trade Me
  const tm = s.tm_summary;
  const trademe: Block = { title: "Trade Me 在架", kpis: tm ? [["在架", `${tm.live} 件`], ["7 天浏览", `${tm.new_views}`], ["7 天收藏", `${tm.new_watchers}`, C.green],
      ["收藏率", tm.watch_rate_pct == null ? "—" : `${tm.watch_rate_pct}%`], ["快到期没人收藏", `${tm.ending_7d_no_watchers}`, tm.ending_7d_no_watchers ? C.amber : undefined]] : [],
    lines: tm ? [
      ...tm.new.slice(0, 3).map((n) => [`新上架 ${cut(n.title, 30)}`, `${n.days_live} 天 · 浏览 ${n.views} · 关注 ${n.watchers}`] as [string, string]),
      ...tm.top_watched.slice(0, 2).map((b) => [`关注最多 ${cut(b.title, 28)}`, `关注 +${b.watchers}`] as [string, string]),
      ...tm.slow.slice(0, 2).map((b) => [`没人关注 ${cut(b.title, 28)}`, `${b.days_on_trademe} 天 · 浏览 ${b.views}`] as [string, string]),
    ] : [], empty: "无数据（Trade Me 数据还没推过来）" };

  // 关注量 / 车系: the numbers `trademe stats` wrote into the snapshot (listings.json), shown as they are
  const pctText = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
  const watchB: Block = { title: "每台关注量 Top 8", kpis: [],
    lines: (tm?.watch_top ?? []).slice(0, 8).map((b) => [cut(b.title, 22), `浏览 ${b.views} · 关注 ${b.watchers} · 收藏率 ${pctText(b.watch_rate_pct)}`] as [string, string]),
    empty: "无数据（关注量还没推过来）" };
  const famB: Block = { title: "车系收藏率（近 7 天）", kpis: [],
    lines: (tm?.families ?? []).slice(0, 8).map((f) => [`${f.label}（${f.listings} 件）`, `浏览 ${f.new_views} · 关注 ${f.new_watchers} · 收藏率 ${pctText(f.watch_rate_pct)}`] as [string, string]),
    empty: "无数据（车系数据还没推过来）" };

  // 比价: the market report's own numbers (our price, cheapest same-car price, % apart), biggest gap first
  const priced = (market?.products ?? []).filter((p) => p.our_price != null && p.market && p.vs_market_pct != null)
    .sort((a, b) => Math.abs(b.vs_market_pct as number) - Math.abs(a.vs_market_pct as number)).slice(0, 8);
  const priceB: Block = { title: "比价：我们价 vs 同款市场价（差价最大 8 台）", kpis: [],
    lines: priced.map((p) => [cut(p.name, 16),
      `我们 ${money(p.our_price as number)} · ${p.market?.source} ${money(p.market?.price ?? 0)} · ${(p.vs_market_pct as number) > 0 ? "+" : ""}${p.vs_market_pct}%`] as [string, string]),
    empty: "无数据（还没有能比的同款价）" };

  // 新品雷达: this week's candidates from the same market report (dropped ones left out), in the report's own order
  const weekCut = new Date(now.getTime() - 7 * 86400000).toISOString();
  const cands = (market?.radar ?? []).filter((r) => r.status !== "dropped" && r.at >= weekCut).slice(0, 5);
  const radarB: Block = { title: "新品雷达（本周候选）", kpis: [],
    lines: cands.map((r) => [cut(`${r.brand} ${r.name}`, 24),
      `${r.family_label} · ${r.overseas_nzd != null ? money(r.overseas_nzd) : "价格缺"}${r.margin_est_nzd != null ? ` · 估毛利 ${money(r.margin_est_nzd)}` : ""} · ${RADAR_LABELS[r.status]}`] as [string, string]),
    empty: "无数据（本周没有新候选）" };

  // 搜索排名: the last `trademe rank` measurement as written, first 8 words
  const rk = tm?.ranks;
  const rankB: Block = { title: `搜索排名（Trade Me 搜索前 ${rk?.depth ?? 200} 名）`, kpis: [],
    lines: (rk?.words ?? []).slice(0, 8).map((w) => [`「${cut(w.q, 18)}」`,
      (w.best_rank == null ? `前 ${rk?.depth ?? 200} 名没有` : `第 ${w.best_rank} 位 ${cut(w.car ?? "", 14)}`) + (w.previous != null ? ` · 上次 ${w.previous}` : "")] as [string, string]),
    empty: "无数据（还没测过排名）" };

  // 库存
  const spare = stock.items.filter((i) => i.status === "InStock" && !i.listingId);
  const stockB: Block = { title: "库存", kpis: [["在库（含已上架、在途）", `${stock.totals.inStock} 台`], ["落地成本", money(stock.totals.stockCost)],
      ["已上架", `${stock.totals.listed} 台`], ["在库没上架", `${spare.length} 台`, spare.length ? C.amber : undefined]],
    lines: spare.slice(0, 3).map((i) => [`没上架 ${cut(i.model, 36)}`, i.landedCost ? money(i.landedCost) : "成本缺"] as [string, string]) };

  // 客人和审批
  const waitingCustomers = (s.inbox ?? []).filter((c) => c.status === "waiting").length;
  const codes = s.pending_codes ?? [];
  const people: Block = { title: "客人和审批", kpis: [["等回复的客人", `${waitingCustomers}`, waitingCustomers ? C.red : C.green],
      ["等码的卡", `${codes.length}`, codes.length ? C.amber : C.green], ["账本要核对", `${flagged.length} 单`, flagged.length ? C.amber : undefined]],
    lines: codes.slice(0, 4).map((c) => [`等「${c.verb}」${cut(c.what, 30)}`, `还剩 ${c.hours_left} 小时`] as [string, string]) };

  // 一句话结论
  const todo = [waitingCustomers && `${waitingCustomers} 位客人等回复`, codes.length && `${codes.length} 张卡等码`,
    missing.length && `${missing.length} 单缺成本`, tm?.ending_7d_no_watchers && `${tm.ending_7d_no_watchers} 件快到期没人关注`].filter(Boolean) as string[];
  const verdict = todo.length ? `要人处理：${todo.join(" · ")}` : "今天没有等人处理的事";

  // 常用口令（from org/capabilities.json via the snapshot, so it never drifts from what the bots do）
  // every phrase the bots answer (帮我查) and every errand with its approval word (帮我办), owner 2026-10-28: all of them
  const items = s.capabilities?.items ?? [];
  const first = (say: string) => say.split(" / ")[0];
  const allAsks = items.filter((i) => i.category === "ask" && i.say).map((i) => first(i.say as string));
  const allDos = items.filter((i) => i.category === "do" && i.say).map((i) => ({ say: first(i.say as string), code: i.code ?? null }));

  const blocks = [sales, ads, trademe, watchB, famB, priceB, radarB, rankB, stockB, people];
  const blockH = (b: Block) => 56 + (b.kpis.length ? 112 : 0) + Math.max(b.lines.length || (b.empty ? 1 : 0), 0) * 40 + 36;
  // the phrase lists go below the blocks and only as many rows as still fit under MAX_H (the blocks come first)
  const fixedH = PAD + 100 + 90 + 20 + blocks.reduce((h, b) => h + blockH(b) + 20, 0) + 56 + 60 + 60 + 50 + PAD;
  const spareRows = Math.max(0, Math.floor((MAX_H - fixedH) / 40));
  const askRows = Math.min(Math.ceil(allAsks.length / 2), spareRows);
  const asks = allAsks.slice(0, askRows * 2);
  const dos = allDos.slice(0, Math.max(0, spareRows - askRows));
  const H = Math.min(MAX_H, fixedH + askRows * 40 + dos.length * 40);

  const title = "DRIFTAE 运营总览";
  const sub = `截至 ${nzTime(now.toISOString())}` + (s.built ? ` · 广告/Trade Me 数据 ${nzTime(s.built)}` : "");
  const footer = "数字和账本网页一样：销售看「账本」，库存看「库存」，广告、Trade Me、关注量和搜索排名看「运营」，比价和新品雷达看「市场」。";
  const allText = [title, sub, verdict, footer, "帮我查（直接跟 bot 说，只看不改）", "帮我办（往外发、花钱、改数的先出卡，回「口令 + 6 位码」）", "回", "码", "直接办",
    ...blocks.flatMap((b) => [b.title, b.empty ?? "", ...b.kpis.flatMap((k) => [k[0], k[1]]), ...b.lines.flatMap((l) => [l[0], l[1] ?? ""])]),
    ...asks, ...dos.flatMap((d) => [d.say, d.code ?? ""]), "0123456789$.,%−—·（）/：…「」+ "].join("");
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
            {b.lines.map(([l, r], i) => (
              <div key={i} style={{ display: "flex", height: 40, alignItems: "center", fontSize: 21, borderTop: `1px solid ${C.line}` }}>
                <div style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap" }}>{l}</div>
                {r ? <div style={{ color: C.muted, marginLeft: 16 }}>{r}</div> : null}
              </div>
            ))}
            {!b.lines.length && b.empty ? <div style={{ fontSize: 20, color: C.muted, height: 40, display: "flex", alignItems: "center" }}>{b.empty}</div> : null}
          </div>
        ))}
        <div style={{ ...box, marginTop: 20 }}>
          <div style={{ fontSize: 26, fontWeight: 700, height: 44 }}>帮我查（直接跟 bot 说，只看不改）</div>
          <div style={{ display: "flex", flexWrap: "wrap" }}>
            {asks.map((a) => <div key={a} style={{ width: "50%", height: 40, fontSize: 21, color: C.text, display: "flex", alignItems: "center", overflow: "hidden", whiteSpace: "nowrap" }}>{`「${cut(a, 19)}」`}</div>)}
          </div>
          <div style={{ fontSize: 26, fontWeight: 700, height: 44, marginTop: 16 }}>帮我办（往外发、花钱、改数的先出卡，回「口令 + 6 位码」）</div>
          {dos.map((d) => (
            <div key={d.say} style={{ display: "flex", height: 40, alignItems: "center", fontSize: 21, borderTop: `1px solid ${C.line}` }}>
              <div style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap" }}>{`「${cut(d.say, 34)}」`}</div>
              <div style={{ width: 170, color: d.code ? C.amber : C.muted, fontWeight: d.code ? 700 : 400, display: "flex", justifyContent: "flex-end" }}>
                {d.code ? `回「${d.code} 码」` : "直接办"}
              </div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 18, color: C.muted, marginTop: 20, lineHeight: 1.5 }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
