import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { getKvClient } from "@/lib/kv";
import { type AdRace, raceLabel, raceState } from "@/lib/ad-race";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// 广告赛马 as one fixed-layout PNG for WeChat (`dt meta race-card` saves it, the bot sends it). Same rows as /ops.
export const dynamic = "force-dynamic";

const W = 1080, PAD = 48, ROW = 54, MAX_ROWS = 10;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", green: "#58ca84", amber: "#f3ba4e" };
const money = (n: number) => `$${n.toFixed(2)}`;
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
  const snap = (await getKvClient().get("ops:metrics")) as { ad_race?: AdRace } | null;
  const race = snap?.ad_race;
  if (!race?.ads) return NextResponse.json({ error: "no ad_race in the ops snapshot yet" }, { status: 404 });
  const rows = race.ads.slice(0, MAX_ROWS);
  const lead = race.ads.find((r) => r.ad === race.leader);
  const title = "DRIFTAE 广告赛马";
  const sub = `每条广告只看它投放的头 ${race.days} 天 · 截至 ${nzTime(race.built)}`;
  const verdict = lead ? `目前领先：${raceLabel(lead)}（每个对话 ${money(lead.cost_per_conversation ?? 0)}）`
    : `还没有能比的：要跑满 ${race.days} 天、展示过 1,000 次`;
  const footer = "同样天数比：花费、点击率、私信对话、每个对话花多少。每个对话越便宜越好。明细在账本网页的「运营」页。";
  const cells = (r: AdRace["ads"][number]) => [raceLabel(r), raceState(r, race.days), money(r.spend), r.ctr_pct === null ? "—" : `${r.ctr_pct}%`,
    String(r.conversations), r.cost_per_conversation === null ? "—" : money(r.cost_per_conversation)];
  const H = PAD + 110 + 80 + 24 + 60 + Math.max(1, rows.length) * ROW + 30 + 70 + PAD;
  const allText = [title, sub, verdict, footer, ...rows.flatMap(cells), "广告", "进度", "花费", "点击率", "对话", "每对话", "还没有广告数据",
    "0123456789$.,%—·（）/：… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "22px 26px" };
  const widths = [400, 210, 110, 100, 80];
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
          <div style={{ fontSize: 46, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ ...box, height: 80, justifyContent: "center", fontSize: 28, fontWeight: 700, color: lead ? C.green : C.amber }}>{verdict}</div>
        <div style={{ ...box, marginTop: 24 }}>
          <div style={{ display: "flex", fontSize: 18, color: C.muted, height: 40, alignItems: "flex-end" }}>
            {["广告", "进度", "花费", "点击率", "对话"].map((h, i) => <div key={h} style={{ width: widths[i] }}>{h}</div>)}
            <div style={{ flex: 1 }}>每对话</div>
          </div>
          {rows.length === 0 && <div style={{ fontSize: 22, color: C.muted, height: ROW, display: "flex", alignItems: "center" }}>还没有广告数据</div>}
          {rows.map((r) => {
            const c = cells(r);
            return (
              <div key={r.ad} style={{ display: "flex", alignItems: "center", height: ROW, fontSize: 22, color: r.ad === race.leader ? C.green : C.text }}>
                {c.slice(0, 5).map((v, i) => (
                  <div key={i} style={{ width: widths[i], overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", paddingRight: 12,
                    color: i === 1 && v !== "可比" ? C.muted : undefined }}>{v}</div>
                ))}
                <div style={{ flex: 1, fontWeight: 700 }}>{c[5]}</div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 18, color: C.amber, marginTop: 24, lineHeight: 1.5 }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
