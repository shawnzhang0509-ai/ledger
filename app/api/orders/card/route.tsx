import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { loadBooks } from "@/lib/books-server";
import { BookLine } from "@/lib/books";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// The books as one fixed-layout PNG for WeChat (`dt orders card` saves it, the bot sends it), so the bots
// stop drawing their own. Same numbers as /books. No customer names.
export const dynamic = "force-dynamic";

const W = 1080, PAD = 48, ROW = 46, MAX_ROWS = 14, MAX_FLAGS = 8, FLAG_LINE = 30;
// Rough wrapped line count for a flag at 20px across the ~930px box (CJK ≈ 20px, Latin ≈ 11px).
const flagLines = (s: string) => Math.max(1, Math.ceil(Array.from(s).reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 20 : 11), 0) / 900));
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", red: "#e86060",
  amber: "#f3ba4e", flagBg: "#3a2420", flagText: "#f6d5c8" };
const SPLIT = [["purchase", "进货", "#6b8afd"], ["air", "空运", "#a77bf3"], ["courier", "快递", "#4fb8c9"],
  ["fee", "Trade Me", "#8d96a3"], ["gp", "毛利", C.green]] as const;

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-NZ", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const nzTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });

// Google Fonts returns only the glyphs asked for, so the CJK font stays small (Vercel's documented pattern).
async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
}

function gpCell(l: BookLine) {
  if (!l.complete) return { text: `缺 ${l.missing.join("·")}`, color: C.amber, size: 20 };
  return { text: money(l.gp), color: l.gp < 0 ? C.red : C.green, size: 24 };
}

export async function GET(request: NextRequest) {
  if (!isAuthenticated(request) && !pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const b = await loadBooks();
  const t = b.totals;
  const rows = b.lines.slice(0, MAX_ROWS);
  const flags = b.lines.flatMap((l) => l.flags.map((f) => `${l.model || l.orderId}：${f}`));
  const shownFlags = flags.slice(0, MAX_FLAGS);
  const missingCount = t.orders - t.complete;
  const kpis: [string, string, string][] = [
    ["销售额（含运费）", money(t.revenue), C.text],
    [`已算清的毛利（${t.complete}/${t.orders} 单）`, t.complete ? money(t.completeGp) : "—", t.completeGp < 0 ? C.red : C.green],
    ["毛利率（算清的单）", t.marginPct == null ? "—" : `${t.marginPct}%`, C.text],
    ["缺成本", `${missingCount} 单`, missingCount ? C.amber : C.green],
  ];
  const footer = "毛利 = 售价 + 运费 − 进货 − 空运 − Trade Me 费 − 快递。缺成本的单不算进毛利。逐单明细在账本网页的「账本」页。";
  const title = "DRIFTAE 账本";
  const sub = `截至 ${nzTime(b.asOf)} · ${t.orders} 单（不含已取消）`;

  const flagH = shownFlags.length ? 90 + shownFlags.reduce((h, f) => h + flagLines(f) * FLAG_LINE + 10, 0) + (flags.length > MAX_FLAGS ? 36 : 0) : 0;
  const H = PAD + 110 + 150 + 24 + 150 + 24 + (90 + rows.length * ROW + (b.lines.length > MAX_ROWS ? 36 : 0)) + 24 + flagH + 90 + PAD;

  const allText = [title, sub, footer, ...kpis.flat(), ...SPLIT.map((s) => s[1]), ...rows.flatMap((l) => [l.model, gpCell(l).text, money(l.price + l.shipping)]),
    ...shownFlags, "费用组成（成本齐全的单，占销售额）", "还没有成本齐全的单，算不出费用组成。补上进货价、汇率、空运费、快递成本就有了。",
    "逐单", "车型", "售价+运费", "毛利", "需要核对", "还有", "单没列出", "条", "0123456789$.,%−·（）/：— "].join("");
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

        <div style={{ ...box, height: 150, marginTop: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 700 }}>费用组成（成本齐全的单，占销售额）</div>
          {t.split ? (
            <div style={{ display: "flex", flexDirection: "column", marginTop: 14 }}>
              <div style={{ display: "flex", height: 30, borderRadius: 8, overflow: "hidden" }}>
                {SPLIT.map(([k, , color]) => (
                  <div key={k} style={{ width: `${Math.max(0, t.split![k])}%`, background: color }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 26, marginTop: 12, fontSize: 19, color: C.muted }}>
                {SPLIT.map(([k, label, color]) => (
                  <div key={k} style={{ display: "flex", alignItems: "center" }}>
                    <div style={{ width: 14, height: 14, borderRadius: 4, background: color, marginRight: 8 }} />
                    <div>{`${label} ${t.split![k]}%`}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 20, color: C.amber, marginTop: 18 }}>还没有成本齐全的单，算不出费用组成。补上进货价、汇率、空运费、快递成本就有了。</div>
          )}
        </div>

        <div style={{ ...box, marginTop: 24 }}>
          <div style={{ display: "flex", fontSize: 18, color: C.muted, height: 40, alignItems: "flex-end" }}>
            <div style={{ width: 440 }}>车型</div>
            <div style={{ width: 150 }}>售价+运费</div>
            <div style={{ flex: 1 }}>毛利</div>
          </div>
          {rows.map((l) => {
            const g = gpCell(l);
            return (
              <div key={l.orderId} style={{ display: "flex", alignItems: "center", height: ROW, fontSize: 24 }}>
                <div style={{ width: 440, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", paddingRight: 16 }}>{l.model || l.orderId}</div>
                <div style={{ width: 150 }}>{money(l.price + l.shipping)}</div>
                <div style={{ flex: 1, color: g.color, fontSize: g.size }}>{g.text}</div>
              </div>
            );
          })}
          {b.lines.length > MAX_ROWS && (
            <div style={{ fontSize: 18, color: C.muted, height: 36, alignItems: "center", display: "flex" }}>{`还有 ${b.lines.length - MAX_ROWS} 单没列出`}</div>
          )}
        </div>

        {shownFlags.length > 0 && (
          <div style={{ ...box, background: C.flagBg, marginTop: 24 }}>
            <div style={{ fontSize: 24, fontWeight: 700, color: "#ffb89a", height: 44 }}>{`需要核对（${flags.length} 条）`}</div>
            {shownFlags.map((f, i) => (
              <div key={i} style={{ fontSize: 20, color: C.flagText, lineHeight: `${FLAG_LINE}px`, marginBottom: 10 }}>{f}</div>
            ))}
            {flags.length > MAX_FLAGS && (
              <div style={{ fontSize: 18, color: C.muted, height: 36 }}>{`还有 ${flags.length - MAX_FLAGS} 条`}</div>
            )}
          </div>
        )}

        <div style={{ fontSize: 18, color: C.amber, marginTop: 24, lineHeight: 1.5 }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
