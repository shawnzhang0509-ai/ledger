import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { loadStockReport } from "@/lib/books-server";
import { STOCK_LABELS } from "@/lib/stock";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// Stock as one fixed-layout PNG for WeChat (`dt stock card` saves it, the bot sends it). Same numbers as /stock.
export const dynamic = "force-dynamic";

const W = 1080, PAD = 48, ROW = 46, MAX_ROWS = 16, MAX_FLAGS = 8, FLAG_LINE = 30;
const flagLines = (s: string) => Math.max(1, Math.ceil(Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 20 : 10), 0) / 930));
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", amber: "#f3ba4e",
  flagBg: "#3a2420", flagText: "#f6d5c8" };
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nzTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const s = await loadStockReport();
  const t = s.totals;
  const unsold = s.items.filter((i) => i.status !== "Sold");
  const rows = unsold.slice(0, MAX_ROWS);
  const flags = s.flags.map((f) => `${f.model}：${f.flag}`);
  const shownFlags = flags.slice(0, MAX_FLAGS);
  const kpis: [string, string, string][] = [
    ["在库台数", `${t.inStock} 台`, C.text],
    ["在库成本（落地）", money(t.stockCost), C.text],
    ["已上架", `${t.listed} 台`, C.text],
    ["本月售出", `${t.soldThisMonth} 台`, C.green],
  ];
  const title = "DRIFTAE 库存";
  const sub = `截至 ${nzTime(s.asOf)} · 在库 = 在库 + 已上架 + 在途`;
  const footer = "落地成本 = 进货价 + 空运 + 快递。卖出时成本带进那条销售，账本里只算一次。明细在账本网页的「库存」页。";

  const flagH = shownFlags.length ? 90 + shownFlags.reduce((h, f) => h + flagLines(f) * FLAG_LINE + 10, 0) + (flags.length > MAX_FLAGS ? 36 : 0) : 0;
  const H = PAD + 110 + 150 + 24 + (90 + Math.max(1, rows.length) * ROW + (unsold.length > MAX_ROWS ? 36 : 0)) + 24 + flagH + 60 + PAD;
  const allText = [title, sub, footer, ...kpis.flat(), ...rows.flatMap((i) => [i.model, STOCK_LABELS[i.status], i.location, money(i.landedCost)]),
    ...shownFlags, ...Object.values(STOCK_LABELS), "车型", "状态", "在哪", "落地成本", "需要核对", "还有", "台没列出", "条", "现在没有在库的车",
    "0123456789$.,%−·（）/：—… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);

  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "22px 26px" };
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
          <div style={{ fontSize: 46, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 14, height: 150 }}>
          {kpis.map(([label, value, color]) => (
            <div key={label} style={{ ...box, flex: 1, justifyContent: "center" }}>
              <div style={{ fontSize: 18, color: C.muted }}>{label}</div>
              <div style={{ fontSize: 36, fontWeight: 700, color, marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </div>
        <div style={{ ...box, marginTop: 24 }}>
          <div style={{ display: "flex", fontSize: 18, color: C.muted, height: 40, alignItems: "flex-end" }}>
            <div style={{ width: 520 }}>车型</div>
            <div style={{ width: 130 }}>状态</div>
            <div style={{ width: 130 }}>在哪</div>
            <div style={{ flex: 1 }}>落地成本</div>
          </div>
          {rows.length === 0 && <div style={{ fontSize: 22, color: C.muted, height: ROW, display: "flex", alignItems: "center" }}>现在没有在库的车</div>}
          {rows.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", height: ROW, fontSize: 24 }}>
              <div style={{ width: 520, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", paddingRight: 16 }}>{i.model}</div>
              <div style={{ width: 130 }}>{STOCK_LABELS[i.status]}</div>
              <div style={{ width: 130, color: C.muted }}>{i.location || "—"}</div>
              <div style={{ flex: 1, color: i.landedCost ? C.text : C.amber }}>{i.landedCost ? money(i.landedCost) : "缺"}</div>
            </div>
          ))}
          {unsold.length > MAX_ROWS && (
            <div style={{ fontSize: 18, color: C.muted, height: 36, alignItems: "center", display: "flex" }}>{`还有 ${unsold.length - MAX_ROWS} 台没列出`}</div>
          )}
        </div>
        {shownFlags.length > 0 && (
          <div style={{ ...box, background: C.flagBg, marginTop: 24 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#ffb89a", height: 44 }}>{`需要核对（${flags.length} 条）`}</div>
            {shownFlags.map((f, i) => (
              <div key={i} style={{ fontSize: 20, color: C.flagText, lineHeight: `${FLAG_LINE}px`, marginBottom: 10 }}>{f}</div>
            ))}
            {flags.length > MAX_FLAGS && <div style={{ fontSize: 18, color: C.muted, height: 36 }}>{`还有 ${flags.length - MAX_FLAGS} 条`}</div>}
          </div>
        )}
        <div style={{ fontSize: 18, color: C.amber, marginTop: 24, lineHeight: 1.5 }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
