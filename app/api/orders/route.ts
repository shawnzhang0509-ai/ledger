import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { Order, calculateGrossProfit, normalizeOrderInput } from "@/lib/data";
import { isAuthenticated as checkAuth } from "@/lib/session";
import { cnyPerNzdOn } from "@/lib/market-server";

const ORDERS_KEY = "diecast:orders";

function kvErrorResponse(error: unknown) {
  if (error instanceof Error && error.message === "KV_NOT_CONFIGURED") {
    return NextResponse.json(
      {
        error:
          "数据库未配置。请在 Vercel 添加 Upstash Redis，并重新部署。",
      },
      { status: 500 }
    );
  }

  console.error("KV error:", error);
  return NextResponse.json({ error: "数据库连接失败" }, { status: 500 });
}

// A 进货价 in RMB saved with no rate takes the sale day's rate, as the bots' fill does (2026-11-25: two orders were saved
// from the page with the rate left empty, so their cost counted as $0 and the profit as almost the whole price).
async function withSaleDayRate<T extends Partial<Order>>(body: T): Promise<T> {
  if ((body.purchaseCostCny ?? 0) > 0 && !(body.exchangeRate ?? 0) && body.dateSold) {
    const rate = await cnyPerNzdOn(body.dateSold);
    if (rate) return { ...body, exchangeRate: rate };
  }
  return body;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kv = getKvClient();
    const orders = ((await kv.get<Order[]>(ORDERS_KEY)) || []).map((order) => normalizeOrderInput(order));
    return NextResponse.json(orders);
  } catch (error) {
    return kvErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kv = getKvClient();
    const body = await request.json();
    const now = new Date().toISOString();
    const normalized = normalizeOrderInput(await withSaleDayRate(body));
    const newOrder: Order = {
      ...normalized,
      id: crypto.randomUUID(),
      grossProfit: calculateGrossProfit(normalized as Order),
      createdAt: now,
      updatedAt: now,
    };
    const orders = (await kv.get<Order[]>(ORDERS_KEY)) || [];
    orders.push(newOrder);
    await kv.set(ORDERS_KEY, orders);
    return NextResponse.json(newOrder, { status: 201 });
  } catch (error) {
    return kvErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kv = getKvClient();
    const body = await request.json();
    const orders = (await kv.get<Order[]>(ORDERS_KEY)) || [];
    const index = orders.findIndex((o) => o.id === body.id);
    if (index === -1) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const normalized = normalizeOrderInput(await withSaleDayRate(body));
    const updatedOrder: Order = {
      ...normalized,
      grossProfit: calculateGrossProfit(normalized as Order),
      updatedAt: new Date().toISOString(),
      createdAt: orders[index].createdAt,
      history: orders[index].history,   // the form doesn't carry it; a page save must not drop the corrections' trail
    };
    orders[index] = updatedOrder;
    await kv.set(ORDERS_KEY, orders);
    return NextResponse.json(updatedOrder);
  } catch (error) {
    return kvErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kv = getKvClient();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) {
      return NextResponse.json({ error: "ID required" }, { status: 400 });
    }
    const orders = (await kv.get<Order[]>(ORDERS_KEY)) || [];
    const filtered = orders.filter((o) => o.id !== id);
    await kv.set(ORDERS_KEY, filtered);
    return NextResponse.json({ success: true });
  } catch (error) {
    return kvErrorResponse(error);
  }
}
