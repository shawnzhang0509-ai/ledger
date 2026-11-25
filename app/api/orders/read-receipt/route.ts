import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated as checkAuth } from "@/lib/session";

export const maxDuration = 60;

// A purchase screenshot (淘宝 / 1688 / 微信 / 支付宝) → the RMB actually paid, for the order form (owner 2026-11-26: filling
// costs by hand is a chore). Read by 百炼 qwen3-vl-plus; the picture is not kept. The upload to Beijing sometimes times out,
// so one retry, and the page shrinks the picture first. The person checks the number before saving.
const PROMPT =
  "这是一张进货付款截图（淘宝、1688、微信或支付宝）。找出实际付款的人民币总额（实付款 / 合计，含运费）。" +
  '只回 JSON：{"cny": 数字或 null, "what": "截图里的商品名，没有就 null"}';

async function ask(image: string): Promise<{ cny: number | null; what: string | null }> {
  const res = await fetch(
    `https://${process.env.DASHSCOPE_WORKSPACE_ID}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.DASHSCOPE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "qwen3-vl-plus",
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: image } }, { type: "text", text: PROMPT }] }],
      }),
      signal: AbortSignal.timeout(25000),
    }
  );
  if (!res.ok) throw new Error(`DashScope ${res.status}`);
  const text: string = (await res.json())?.choices?.[0]?.message?.content ?? "";
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
  const cny = Number(json.cny);
  return { cny: Number.isFinite(cny) && cny > 0 ? Math.round(cny * 100) / 100 : null, what: json.what || null };
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!process.env.DASHSCOPE_API_KEY || !process.env.DASHSCOPE_WORKSPACE_ID)
    return NextResponse.json({ error: "读图还没配置好" }, { status: 500 });
  const { image } = await request.json();
  if (typeof image !== "string" || !image.startsWith("data:image/") || image.length > 3_000_000)
    return NextResponse.json({ error: "图片不对或太大" }, { status: 400 });
  for (let i = 0; i < 2; i++) {
    try {
      return NextResponse.json(await ask(image));
    } catch (e) {
      console.error("read-receipt:", e);
    }
  }
  return NextResponse.json({ error: "没读出来，请手填" }, { status: 502 });
}
