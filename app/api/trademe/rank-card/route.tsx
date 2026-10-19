import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { pushTokenMatches } from "@/lib/session";

// Trade Me search ranks (and title proposals) as one fixed-layout PNG for WeChat: `dt trademe rank-card` posts the
// numbers it measured, this draws them, the bot sends the image. Public listing data only.
export const dynamic = "force-dynamic";

type Hit = { rank: number; label: string };
type Row = { group: string; q: string; total: number | null; best: Hit | null; prev: number | null; count: number };
type Title = { car: string; current: string; proposed: string; gains: string };
type Body = { view?: "ranks" | "titles"; measured: string; previous?: string | null; depth: number; rows?: Row[]; titles?: Title[]; note?: string };

const W = 1080, PAD = 48, ROW = 50;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", red: "#e86060",
  amber: "#f3ba4e", blue: "#6b8afd", line: "#2a2f39" };
const nzTime = (iso: string) =>
  new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const rankColor = (r: number | null) => (r == null ? C.muted : r <= 10 ? C.green : r <= 50 ? C.amber : C.red);

// Google Fonts returns only the glyphs asked for, so the CJK font stays small (same as /api/orders/card).
async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
}

function change(r: Row): { text: string; color: string } {
  const now = r.best?.rank ?? null;
  if (r.prev === undefined || (r.prev === null && now === null)) return { text: "", color: C.muted };
  if (r.prev === null) return { text: "新进", color: C.green };
  if (now === null) return { text: "掉出", color: C.red };
  const d = r.prev - now;
  return d === 0 ? { text: "=", color: C.muted } : { text: d > 0 ? `↑${d}` : `↓${-d}`, color: d > 0 ? C.green : C.red };
}

export async function POST(request: NextRequest) {
  if (!pushTokenMatches(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let b: Body;
  try {
    b = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!b?.measured) return NextResponse.json({ error: "Missing measured" }, { status: 400 });
  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "22px 26px" };
  const sub = `测于 ${nzTime(b.measured)}${b.previous ? ` · 对比 ${nzTime(b.previous)}` : ""} · Trade Me「最相关」排序，看前 ${b.depth} 名`;

  if (b.view === "titles") {
    const titles = (b.titles ?? []).slice(0, 24);
    const title = "Trade Me 标题改写建议";
    const footer = b.note ?? "写法：车名 + 收藏者会搜的代号/车手/年份 + 1:18 Diecast Model Car 连写 + 品牌；不用括号和破折号。";
    const H = PAD + 110 + titles.length * 132 + 90 + PAD;
    const allText = [title, sub, footer, "现在", "建议", "多拿的词", ...titles.flatMap((t) => [t.car, t.current, t.proposed, t.gains]), "0123456789:/·… "].join("");
    const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
    return new ImageResponse(
      (
        <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
          <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
            <div style={{ fontSize: 44, fontWeight: 700 }}>{title}</div>
            <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{`${titles.length} 条 · 不超过 80 字符 · 还没改到 Trade Me 上`}</div>
          </div>
          {titles.map((t) => (
            <div key={t.car} style={{ ...box, height: 120, marginBottom: 12, padding: "14px 22px", justifyContent: "center" }}>
              <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>
                <div style={{ flex: 1 }}>{t.car}</div>
                <div style={{ fontSize: 17, color: C.blue, fontWeight: 400 }}>{t.gains ? `多拿：${t.gains}` : ""}</div>
              </div>
              <div style={{ display: "flex", fontSize: 18, color: C.muted, marginTop: 6 }}>
                <div style={{ width: 56 }}>现在</div>
                <div style={{ flex: 1, textDecoration: "line-through", overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{t.current}</div>
              </div>
              <div style={{ display: "flex", fontSize: 19, color: C.green, marginTop: 4 }}>
                <div style={{ width: 56, color: C.muted, fontSize: 18 }}>建议</div>
                <div style={{ flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>{t.proposed}</div>
              </div>
            </div>
          ))}
          <div style={{ fontSize: 18, color: C.amber, marginTop: 12, lineHeight: 1.5 }}>{footer}</div>
        </div>
      ),
      { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
    );
  }

  const rows = (b.rows ?? []).slice(0, 60);
  const groups = Array.from(new Set(rows.map((r) => r.group)));
  const top10 = rows.filter((r) => r.best && r.best.rank <= 10).length;
  const top50 = rows.filter((r) => r.best && r.best.rank <= 50).length;
  const none = rows.filter((r) => !r.best).length;
  const kpis: [string, string, string][] = [
    ["前 10 名", `${top10} / ${rows.length}`, C.green],
    ["前 50 名", `${top50} / ${rows.length}`, C.amber],
    [`不在前 ${b.depth}`, `${none} 个词`, none ? C.red : C.green],
  ];
  const title = "Trade Me 搜索排名";
  const footer = b.note ?? `每行 = 搜这个词时我们排得最靠前的一件。名次越小越好，— = 不在前 ${b.depth} 名。Trade Me 不公开排序规则，这是实测。`;
  const H = PAD + 110 + 140 + 24 + groups.length * 70 + rows.length * ROW + (groups.length - 1) * 16 + 110 + PAD;
  const allText = [title, sub, footer, ...kpis.flat(), ...groups, ...rows.flatMap((r) => [r.q, r.best?.label ?? "", change(r).text]),
    "搜索词", "结果数", "名次", "排最前的一件", "变化", "新进", "掉出", "件", "0123456789,=↑↓—·/:… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", gap: 14, height: 140 }}>
          {kpis.map(([label, value, color]) => (
            <div key={label} style={{ ...box, flex: 1, justifyContent: "center" }}>
              <div style={{ fontSize: 18, color: C.muted }}>{label}</div>
              <div style={{ fontSize: 36, fontWeight: 700, color, marginTop: 8 }}>{value}</div>
            </div>
          ))}
        </div>
        {groups.map((g, gi) => (
          <div key={g} style={{ ...box, marginTop: gi ? 16 : 24, padding: "10px 26px" }}>
            <div style={{ display: "flex", fontSize: 18, color: C.muted, height: 60, alignItems: "center" }}>
              <div style={{ width: 270, fontSize: 22, fontWeight: 700, color: C.text }}>{g}</div>
              <div style={{ width: 120 }}>结果数</div>
              <div style={{ width: 100 }}>名次</div>
              <div style={{ flex: 1 }}>排最前的一件</div>
              <div style={{ width: 80 }}>变化</div>
            </div>
            {rows.filter((r) => r.group === g).map((r) => {
              const c = change(r);
              return (
                <div key={r.q} style={{ display: "flex", alignItems: "center", height: ROW, fontSize: 22, borderTop: `1px solid ${C.line}` }}>
                  <div style={{ width: 270 }}>{r.q}</div>
                  <div style={{ width: 120, color: C.muted, fontSize: 20 }}>{r.total == null ? "—" : r.total.toLocaleString("en-NZ")}</div>
                  <div style={{ width: 100, fontWeight: 700, color: rankColor(r.best?.rank ?? null) }}>{r.best ? `${r.best.rank}` : "—"}</div>
                  <div style={{ flex: 1, fontSize: 18, color: C.muted, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", paddingRight: 12 }}>
                    {r.best ? `${r.best.label}${r.count > 1 ? ` · 共 ${r.count} 件` : ""}` : ""}
                  </div>
                  <div style={{ width: 80, color: c.color, fontWeight: 700 }}>{c.text}</div>
                </div>
              );
            })}
          </div>
        ))}
        <div style={{ fontSize: 18, color: C.amber, marginTop: 20, lineHeight: 1.5 }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
