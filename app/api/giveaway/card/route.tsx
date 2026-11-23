import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import { drawStats, loadDraw, winnerContact } from "@/lib/giveaway-db";
import { isAuthenticated, pushTokenMatches } from "@/lib/session";

// The month's draw as one PNG for WeChat (`dt giveaway card`, the bot's 「抽奖」): prize, time left or the winner, how
// many entered. Same numbers as /api/giveaway (team view) and www.driftae.com/giveaway.
export const dynamic = "force-dynamic";

const W = 1080, PAD = 48;
const C = { bg: "#111318", card: "#1b1f27", text: "#f0f2f5", muted: "#9aa3ae", gold: "#C7A96B", green: "#58ca84", amber: "#f3ba4e" };
const MONTH = /^\d{4}-\d{2}$/;
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
  const want = request.nextUrl.searchParams.get("month");
  const found = await loadDraw(want && MONTH.test(want) ? want : undefined);
  const title = "DRIFTAE 本月抽奖";
  let sub = "还没有设奖品", prize = "跟 bot 说奖品名字，再发一张奖品照片", status = "还没开始", statusColor = C.amber, image: string | null = null;
  let kpis: [string, string][] = [];
  let post: string | null = null;
  if (found) {
    const { draw, entries } = found;
    const st = await drawStats(draw.month);
    const left = new Date(draw.ends_at).getTime() - Date.now();
    sub = `${draw.month} · 截止 ${nzTime(draw.ends_at)}`;
    prize = draw.prize;
    image = draw.image;
    if (draw.winner) {
      const i = entries.findIndex((e) => e.id === draw.winner);
      status = `中奖：${i >= 0 ? entries[i].display : "—"}`;
      statusColor = C.green;
      post = (await winnerContact(draw.month, draw.winner))?.instagram_post ?? null;
    } else if (left > 0) {
      const d = Math.floor(left / 86400e3), h = Math.floor((left % 86400e3) / 3600e3);
      status = d > 0 ? `还剩 ${d} 天 ${h} 小时` : `还剩 ${h} 小时`;
      statusColor = C.gold;
    } else {
      status = entries.length ? "已截止，马上抽" : "已截止，没人报名";
    }
    kpis = [["抽奖机会", String(entries.length)], ["已确认邮箱", String(st.confirmed)], ["等确认邮箱", String(st.pending)], ["邀请加的", String(st.invites)]];
  }
  const footer = "怎么参加：IG 发帖艾特 @driftaenz + #driftaegiveaway，再到 driftae.com/giveaway 填表、确认邮箱。";
  const H = PAD + 110 + 380 + (kpis.length ? 24 + 150 : 0) + (post ? 70 : 0) + 90 + PAD;
  const allText = [title, sub, prize, status, footer, ...kpis.flat(), post ?? "", "中奖人的 IG 帖子：", "0123456789$.,%−·（）/：—… "].join("");
  const [regular, bold] = await Promise.all([font(allText, 400), font(allText, 700)]);
  const box = { display: "flex", flexDirection: "column" as const, background: C.card, borderRadius: 16, padding: "22px 26px" };
  return new ImageResponse(
    (
      <div style={{ width: W, height: H, display: "flex", flexDirection: "column", background: C.bg, padding: PAD, fontFamily: "NotoSC", color: C.text }}>
        <div style={{ display: "flex", flexDirection: "column", height: 110 }}>
          <div style={{ fontSize: 46, fontWeight: 700 }}>{title}</div>
          <div style={{ fontSize: 22, color: C.muted, marginTop: 6 }}>{sub}</div>
        </div>
        <div style={{ ...box, flexDirection: "row", height: 380, alignItems: "center", gap: 30 }}>
          {image ? <img src={image} width={330} height={330} style={{ borderRadius: 12, objectFit: "cover" }} />
            : <div style={{ width: 330, height: 330, borderRadius: 12, background: "#2a2f39", display: "flex" }} />}
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ fontSize: 30, lineHeight: 1.35 }}>{prize}</div>
            <div style={{ fontSize: 44, fontWeight: 700, color: statusColor, marginTop: 24 }}>{status}</div>
          </div>
        </div>
        {kpis.length > 0 && (
          <div style={{ display: "flex", gap: 14, height: 150, marginTop: 24 }}>
            {kpis.map(([label, value]) => (
              <div key={label} style={{ ...box, flex: 1, justifyContent: "center" }}>
                <div style={{ fontSize: 20, color: C.muted }}>{label}</div>
                <div style={{ fontSize: 40, fontWeight: 700, marginTop: 8 }}>{value}</div>
              </div>
            ))}
          </div>
        )}
        {post && <div style={{ display: "flex", fontSize: 22, color: C.muted, height: 70, alignItems: "flex-end" }}>中奖人的 IG 帖子：{post}</div>}
        <div style={{ display: "flex", fontSize: 20, color: C.muted, height: 90, alignItems: "flex-end" }}>{footer}</div>
      </div>
    ),
    { width: W, height: H, fonts: [{ name: "NotoSC", data: regular, weight: 400 }, { name: "NotoSC", data: bold, weight: 700 }] },
  );
}
