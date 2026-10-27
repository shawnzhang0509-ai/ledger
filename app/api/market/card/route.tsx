import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { MarketReport, RADAR_LABELS, REF_LABELS } from "@/lib/market";
import { loadMarketReport } from "@/lib/market-server";
import { loadBooks } from "@/lib/books-server";
import type { BooksReport } from "@/lib/books";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// The market snapshot as one fixed-layout PNG for WeChat (`dt market card --view prices|demand|radar` saves it, the
// bot sends it). Same numbers as /market.
export const dynamic = "force-dynamic";

const W = 1080, PAD = 48, ROW = 50, MAX_ROWS = 14;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", red: "#e86060",
  amber: "#f3ba4e", blue: "#6b8afd", line: "#2a2f39" };
const nz = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-NZ")}`);
const nzTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
}

type Col = { head: string; width: number | "flex"; align?: "right" };
type Cell = { text: string; color?: string; bold?: boolean };

function view(s: MarketReport, v: string, books: BooksReport | null = null) {
  if (v === "why") {
    // 价格怎么来的 (Stella 2026-10-27: "我们比海外零售高70%的合理性是？"): where each dollar of our real sales went (the
    // books, complete sales only), then per car our price against the cheapest price recorded elsewhere and a cost guess.
    const sp = books?.totals.split;
    const lines = s.products.map((p) => {
      const away = p.others.filter((o) => o.kind === "recorded").sort((a, b) => a.total_nzd - b.total_nzd)[0];
      const cost = p.goods_cost_nzd != null ? p.goods_cost_nzd + s.freight_est_nzd : null;
      return { p, away, cost, pct: p.our_price && away ? Math.round(((p.our_price - away.total_nzd) / away.total_nzd) * 100) : null };
    }).filter((x) => x.p.our_price && x.away).sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, MAX_ROWS);
    return {
      title: "DRIFTAE 我们的价格怎么来的",
      sub: `账本里已算清的 ${books?.totals.complete ?? 0} 单：每收 $100，钱去了哪里`,
      kpis: (sp ? [
        ["进货", `$${Math.round(sp.purchase)}`, C.text],
        ["空运 + 快递", `$${Math.round(sp.air + sp.courier)}`, C.text],
        ["Trade Me 费", `$${Math.round(sp.fee)}`, C.text],
        ["毛利", `$${Math.round(sp.gp)}`, C.green],
      ] : [["已算清的单", "0", C.amber]]) as [string, string, string][],
      tables: [{
        name: "每台车：我们 vs 别处最便宜（记录过的价格）",
        cols: [{ head: "车", width: "flex" }, { head: "我们", width: 100 }, { head: "别处", width: 110 }, { head: "高", width: 90 },
          { head: "进货+运费(估)", width: 160 }, { head: "毛利(估)", width: 120 }] as Col[],
        rows: lines.map(({ p, away, cost, pct }) => [{ text: p.name }, { text: nz(p.our_price) },
          { text: `${nz(away?.total_nzd)}${away && !away.shipping_known ? "*" : ""}` },
          { text: pct == null ? "—" : `${pct > 0 ? "+" : ""}${pct}%`, color: (pct ?? 0) > 30 ? C.amber : C.green, bold: true },
          { text: nz(cost), color: C.muted },
          { text: cost == null || !p.our_price ? "—" : nz(p.our_price - cost), color: cost != null && p.our_price && p.our_price - cost > 0 ? C.green : C.red }] as Cell[]),
      }],
      footer: `上面四格是我们真实成交的平均（账本），下面是估算：进货价 × 汇率 + $${s.freight_est_nzd} 运费估计，不含 Trade Me 费。` +
        "别处 = 有人记录过的同款价格（* = 不含到新西兰的运费，比的时候要加上）。我们每台都单独空运到客人家门口，这笔钱在上面「空运 + 快递」里。",
    };
  }
  if (v === "demand") {
    const d = s.demand ?? { built: s.built, days: 30, sales_days: 90, families: [], products: [] };
    const fams = d.families;
    const top = [...d.products].sort((a, b) => b.sold - a.sold || b.tm_watchers - a.tm_watchers || b.tm_views - a.tm_views).slice(0, 8);
    return {
      title: "DRIFTAE 车系需求",
      sub: `截至 ${nzTime(d.built)} · 浏览/访客/咨询看近 ${d.days} 天，成交看近 ${d.sales_days} 天`,
      kpis: [
        ["卖得最好", fams[0]?.label ?? "—", C.green],
        ["收藏率最高", [...fams].sort((a, b) => (b.watch_rate_pct ?? -1) - (a.watch_rate_pct ?? -1))[0]?.label ?? "—", C.amber],
        ["成交合计", `${fams.reduce((n, f) => n + f.sold, 0)} 单`, C.text],
      ] as [string, string, string][],
      tables: [
        {
          name: "按车系（按每台成交、再按收藏率排）",
          cols: [{ head: "车系", width: 190 }, { head: "台数", width: 90 }, { head: "TM 浏览", width: 120 }, { head: "收藏率", width: 120 },
            { head: "成交", width: 90 }, { head: "每台成交", width: 130 }, { head: "咨询", width: 90 }, { head: "广告对话", width: "flex" }] as Col[],
          rows: fams.map((f) => [{ text: f.label, bold: true }, { text: `${f.products}` }, { text: `${f.tm_views}` },
            { text: f.watch_rate_pct == null ? "—" : `${f.watch_rate_pct}%`, color: C.amber }, { text: `${f.sold}`, color: f.sold ? C.green : C.muted },
            { text: f.sold_per_product == null ? "—" : `${f.sold_per_product}` }, { text: `${f.messenger_starts}` }, { text: `${f.ad_conversations}` }] as Cell[]),
        },
        {
          name: "单台车（成交、收藏、咨询最多的）",
          cols: [{ head: "车", width: "flex" }, { head: "成交", width: 90 }, { head: "TM 浏览", width: 120 }, { head: "收藏", width: 90 },
            { head: "网站", width: 90 }, { head: "咨询", width: 90 }] as Col[],
          rows: top.map((p) => [{ text: p.name }, { text: `${p.sold}`, color: p.sold ? C.green : C.muted }, { text: `${p.tm_views}` },
            { text: `${p.tm_watchers}` }, { text: `${p.site_visitors}` }, { text: `${p.messenger_starts}` }] as Cell[]),
        },
      ],
      footer: "数字小：只看方向。咨询 = 从商品页或广告进来的 Messenger 对话（2026-10-17 起）。明细在账本网页的「市场」页。",
    };
  }
  if (v === "radar") {
    const cands = s.radar.filter((c) => c.status !== "dropped").slice(0, MAX_ROWS);
    return {
      title: "DRIFTAE 新品雷达",
      sub: `截至 ${nzTime(s.built)} · 我们还没卖的车，按同车系卖得怎样排`,
      kpis: [
        ["候选", `${s.radar.filter((c) => c.status === "proposed").length} 台`, C.text],
        ["要", `${s.radar.filter((c) => c.status === "kept").length} 台`, C.green],
        ["缺进货价", `${cands.filter((c) => c.supplier_cny == null).length} 台`, C.amber],
      ] as [string, string, string][],
      tables: [{
        name: "候选（回 bot「要 / 不要 <id>」）",
        cols: [{ head: "id", width: 140 }, { head: "车 · 货号", width: "flex" }, { head: "海外", width: 120 }, { head: "同系我们卖", width: 150 },
          { head: "预估毛利", width: 130 }, { head: "", width: 80 }] as Col[],
        rows: cands.map((c) => [{ text: c.id, color: C.muted }, { text: `${c.brand} ${c.name} · ${c.ref}` },
          { text: `${nz(c.overseas_nzd)}${c.overseas_nzd != null && !c.shipping_known ? "*" : ""}` }, { text: nz(c.family_our_median_price) },
          { text: c.margin_est_nzd == null ? "缺进货价" : nz(c.margin_est_nzd), color: c.margin_est_nzd == null ? C.amber : c.margin_est_nzd > 0 ? C.green : C.red },
          { text: RADAR_LABELS[c.status], color: c.status === "kept" ? C.green : C.muted }] as Cell[]),
      }],
      footer: `* = 不含到新西兰的运费。预估毛利 = 同车系我们现价中位数 − (进货价 × 汇率 + $${s.freight_est_nzd} 运费估计)，不是账本数字。进不进货由人决定。`,
    };
  }
  if (v === "refs") {
    const rows = s.missing_refs.slice(0, MAX_ROWS);
    return {
      title: "DRIFTAE 缺货号",
      sub: `截至 ${nzTime(s.built)} · 货号 = 盒子侧面标签上的厂家编号，比价靠它对同款`,
      kpis: [
        ["已确认", `${s.refs.confirmed} 台`, C.green],
        ["待核对", `${s.refs.candidate} 台`, C.amber],
        ["未知", `${s.refs.unknown} 台`, s.refs.unknown ? C.red : C.green],
      ] as [string, string, string][],
      tables: [{
        name: "请拍盒子标签发给 bot（未知的优先）",
        cols: [{ head: "车", width: "flex" }, { head: "网上找到的", width: 170 }, { head: "状态", width: 120 }] as Col[],
        rows: rows.map((m) => [{ text: m.name }, { text: m.ref ?? "—", color: C.muted },
          { text: REF_LABELS[m.status], color: m.status === "unknown" ? C.red : C.amber }] as Cell[]),
      }],
      footer: "拍到标签后跟 bot 说「这台的货号是 …」，或在账本「市场」页点确认。",
    };
  }
  const rows = s.products.filter((p) => p.bayhobbies).slice(0, MAX_ROWS);
  const dearer = s.products.filter((p) => (p.vs_bayhobbies_pct ?? 0) > 15).length;
  return {
    title: "DRIFTAE 比价 · Bay Hobbies",
    sub: `截至 ${nzTime(s.built)}${s.bayhobbies_seen ? ` · Bay Hobbies 看于 ${nzTime(s.bayhobbies_seen)}` : ""} · 新西兰零售价，含 GST`,
    kpis: [
      ["Bay Hobbies 有的", `${rows.length} 台`, C.text],
      ["比它贵 15% 以上", `${dearer} 台`, dearer ? C.red : C.green],
      ["货号已确认", `${s.refs.confirmed} / ${s.products.length}`, s.refs.confirmed ? C.green : C.amber],
    ] as [string, string, string][],
    tables: [{
      name: "我们 vs Bay Hobbies（同款 = 同一货号；同车型 = 别的颜色）",
      cols: [{ head: "车", width: "flex" }, { head: "我们", width: 110 }, { head: "Bay Hobbies", width: 160 }, { head: "", width: 100 },
        { head: "差", width: 100 }, { head: "进货价", width: 110 }] as Col[],
      rows: rows.map((p) => [{ text: p.name }, { text: nz(p.our_price) }, { text: nz(p.bayhobbies?.price) },
        { text: p.bayhobbies?.match === "ref" ? "同款" : "同车型", color: p.bayhobbies?.match === "ref" ? C.green : C.muted },
        { text: p.vs_bayhobbies_pct == null ? "—" : `${p.vs_bayhobbies_pct > 0 ? "+" : ""}${p.vs_bayhobbies_pct}%`,
          color: (p.vs_bayhobbies_pct ?? 0) > 15 ? C.red : C.green, bold: true },
        { text: nz(p.goods_cost_nzd), color: C.muted }] as Cell[]),
    }],
    footer: "Bay Hobbies 不卖 Sun Star，拉力车没有参考。进货价 = 供应商价 × 汇率，不含运费。改价走改价码。",
  };
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const which = request.nextUrl.searchParams.get("view") ?? "prices";
  const [s, books] = await Promise.all([loadMarketReport(), which === "why" ? loadBooks() : Promise.resolve(null)]);
  const v = view(s, which, books);
  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "18px 26px" };
  const tableH = (rows: number) => 50 + 44 + Math.max(1, rows) * ROW + 20;
  const H = PAD + 110 + 140 + v.tables.reduce((h, t) => h + 24 + tableH(t.rows.length), 0) + 100 + PAD;
  const allText = [v.title, v.sub, v.footer, ...v.kpis.flat(), ...v.tables.flatMap((t) => [t.name, ...t.cols.map((c) => c.head),
    ...t.rows.flatMap((r) => r.map((c) => c.text))]), "暂无数据", "0123456789$%+−-.,*?·（）/：—… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  const w = (c: Col) => (c.width === "flex" ? { flex: 1, minWidth: 0 } : { width: c.width });
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{v.title}</div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{v.sub}</div>
        </div>
        <div style={{ display: "flex", gap: 14, height: 140 }}>
          {v.kpis.map(([label, value, color]) => (
            <div key={label} style={{ ...box, flex: 1, justifyContent: "center" }}>
              <div style={{ fontSize: 18, color: C.muted }}>{label}</div>
              <div style={{ fontSize: 34, fontWeight: 700, color, marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </div>
        {v.tables.map((t) => (
          <div key={t.name} style={{ ...box, marginTop: 24, height: tableH(t.rows.length) }}>
            <div style={{ fontSize: 22, fontWeight: 700, height: 50, display: "flex", alignItems: "center" }}>{t.name}</div>
            <div style={{ display: "flex", fontSize: 17, color: C.muted, height: 44, alignItems: "center" }}>
              {t.cols.map((c) => <div key={c.head} style={{ ...w(c), display: "flex" }}>{c.head}</div>)}
            </div>
            {t.rows.length === 0 && <div style={{ fontSize: 20, color: C.muted, height: ROW, display: "flex", alignItems: "center" }}>暂无数据</div>}
            {t.rows.map((r, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", height: ROW, fontSize: 20, borderTop: `1px solid ${C.line}` }}>
                {r.map((c, j) => (
                  <div key={j} style={{ ...w(t.cols[j]), display: "flex", color: c.color ?? C.text, fontWeight: c.bold ? 700 : 400, paddingRight: 12 }}>
                    <div style={{ overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{c.text}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        <div style={{ fontSize: 18, color: C.amber, marginTop: 20, lineHeight: 1.5 }}>{v.footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
