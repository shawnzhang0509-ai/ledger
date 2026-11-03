import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { pushTokenMatches } from "@/lib/session";

// What the team's bots do (the /team page) as one PNG for WeChat: `dt team caps` posts the snapshot, this draws it,
// the bot sends the image plus the page link instead of a wall of text. Since 2026-11-03 (owner: "一张图说全部好像有
// 难度，都分开") dt sends one view at a time — 任务 / 指令 / 码 — with its own title, and each row may carry its own
// second line (`line`) and right-hand tag (`tag`, e.g. 等码 / 做完了).
export const dynamic = "force-dynamic";

type Item = { name: string; when?: string; say?: string; code?: string; status?: string; line?: string; tag?: string; tone?: "amber" | "green" | "muted" };
type Cat = { label: string; items: Item[]; empty?: string };
type Body = { cats: Cat[]; page?: string; title?: string; sub?: string };

const W = 1080, PAD = 44, ROW = 74, HEAD = 66;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", amber: "#f3ba4e", green: "#58ca84", line: "#2a2f39" };
const TONE = ["#6bb8fd", "#8f9bff", "#58ca84", "#f3ba4e", "#9aa3ae"];

// Google Fonts returns only the glyphs asked for, so the CJK font stays small (same as /api/orders/card).
async function font(text: string, weight: number) {
  const chars = Array.from(new Set(Array.from(text))).join("");
  const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@${weight}&text=${encodeURIComponent(chars)}`)).text();
  const url = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/)?.[1];
  if (!url) throw new Error("font");
  return (await fetch(url)).arrayBuffer();
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
  const cats = (b?.cats ?? []).map((c) => ({ ...c, items: (c.items ?? []).slice(0, 24) })).filter((c) => c.items.length || c.empty);
  if (!cats.length) return NextResponse.json({ error: "Missing cats" }, { status: 400 });
  const title = b.title || "团队的 bot 能做什么";
  const sub = b.sub || "三个人的 bot 一样 · 定时消息三人同发 · 回「词 码」才执行";
  const n = cats.reduce((s, c) => s + (c.items.length || 1), 0);
  const H = PAD + 110 + cats.length * (HEAD + 20) + n * ROW + (b.page ? 60 : 0) + PAD;
  const line = (i: Item) => i.line ?? (i.say ? `说：「${i.say}」` : i.when ?? "");
  const tag = (i: Item) => i.tag ?? (i.code ? `回「${i.code} 码」` : "");
  const toneOf = (i: Item) => (i.tone === "green" ? C.green : i.tone === "muted" ? C.muted : C.amber);
  const allText = [title, sub, b.page ?? "", ...cats.flatMap((c) => [c.label, c.empty ?? "", ...c.items.flatMap((i) => [i.name, line(i), tag(i), i.status ?? ""])]),
    "回码说：「」0123456789:/·… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        {cats.map((c, ci) => (
          <div key={c.label} style={{ display: "flex", flexDirection: "column", background: C.card, borderRadius: 16, padding: "0 24px", marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", height: HEAD, fontSize: 26, fontWeight: 700, color: TONE[ci % TONE.length] }}>{c.label}</div>
            {c.items.map((i) => (
              <div key={i.name} style={{ display: "flex", alignItems: "center", height: ROW, borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                  <div style={{ fontSize: 24, fontWeight: 700 }}>{i.name}</div>
                  <div style={{ fontSize: 18, color: C.muted, marginTop: 2, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
                    {`${line(i)}${i.status ? ` · ${i.status}` : ""}`}
                  </div>
                </div>
                {tag(i) ? <div style={{ fontSize: 20, color: toneOf(i), border: `1px solid ${toneOf(i)}`, borderRadius: 999, padding: "4px 14px", marginLeft: 16 }}>{tag(i)}</div> : null}
              </div>
            ))}
            {!c.items.length && c.empty ? (
              <div style={{ display: "flex", alignItems: "center", height: ROW, borderTop: `1px solid ${C.line}`, fontSize: 20, color: C.muted }}>{c.empty}</div>
            ) : null}
          </div>
        ))}
        {b.page ? <div style={{ fontSize: 20, color: C.muted, marginTop: 8 }}>{`详细说明：${b.page}`}</div> : null}
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
