import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { pushTokenMatches } from "@/lib/session";

// A few Trade Me listings as one PNG for WeChat, each with its photo, title and one line of numbers:
// `dt trademe stats --card` (the weekly report) and `dt trademe relist-request` (what is being approved) post them,
// this draws them, the bot sends the image. One picture keeps photo and car together (separate photos arrive
// unlabelled and before the text). Public listing data only.
export const dynamic = "force-dynamic";

type Car = { photo?: string | null; title: string; line?: string };
type Section = { label: string; tone?: "good" | "bad" | "warn"; cars: Car[] };
type Body = { title: string; sub?: string; sections: Section[]; note?: string };

const W = 1080, PAD = 48, PHOTO_W = 240, PHOTO_H = 180, ROW = PHOTO_H + 24;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", red: "#e86060",
  amber: "#f3ba4e", line: "#2a2f39" };
const TONE = { good: C.green, bad: C.red, warn: C.amber };
// photos only from where our listings' photos live (Trade Me's CDN, our R2 bucket)
const photoOk = (u?: string | null) => !!u && /^https:\/\/([\w-]+\.)*(tmcdn\.co\.nz|r2\.dev)\//.test(u);

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
  let left = 12;
  const sections = (b?.sections ?? []).map((s) => {
    const cars = (s.cars ?? []).slice(0, left);
    left -= cars.length;
    return { ...s, cars };
  }).filter((s) => s.cars.length);
  if (!b?.title || !sections.length) return NextResponse.json({ error: "Missing title or cars" }, { status: 400 });

  const cars = sections.flatMap((s) => s.cars);
  const H = PAD + (b.sub ? 110 : 70) + sections.length * 64 + cars.length * ROW + (b.note ? 80 : 0) + PAD;
  const allText = [b.title, b.sub ?? "", b.note ?? "", ...sections.map((s) => s.label), ...cars.flatMap((c) => [c.title, c.line ?? ""]),
    "无图0123456789$:/·… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: b.sub ? 110 : 70 }}>
          <div style={{ fontSize: 44, fontWeight: 700 }}>{b.title}</div>
          {b.sub ? <div style={{ fontSize: 20, color: C.muted, marginTop: 6 }}>{b.sub}</div> : null}
        </div>
        {sections.map((s) => (
          <div key={s.label} style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", height: 64, alignItems: "center", fontSize: 26, fontWeight: 700, color: TONE[s.tone ?? "warn"] ?? C.amber }}>
              {s.label}
            </div>
            {s.cars.map((c, i) => (
              <div key={i} style={{ display: "flex", height: PHOTO_H, marginBottom: ROW - PHOTO_H, background: C.card, borderRadius: 16, overflow: "hidden" }}>
                {photoOk(c.photo) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.photo!} width={PHOTO_W} height={PHOTO_H} style={{ objectFit: "cover" }} alt="" />
                ) : (
                  <div style={{ width: PHOTO_W, height: PHOTO_H, display: "flex", alignItems: "center", justifyContent: "center", color: C.muted, fontSize: 20, borderRight: `1px solid ${C.line}` }}>无图</div>
                )}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 26px" }}>
                  <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.3, maxHeight: 68, overflow: "hidden" }}>{c.title}</div>
                  {c.line ? <div style={{ fontSize: 22, color: C.muted, marginTop: 10 }}>{c.line}</div> : null}
                </div>
              </div>
            ))}
          </div>
        ))}
        {b.note ? <div style={{ fontSize: 18, color: C.amber, marginTop: 16, lineHeight: 1.5 }}>{b.note}</div> : null}
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
