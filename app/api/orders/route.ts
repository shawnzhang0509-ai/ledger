import { NextRequest, NextResponse } from "next/server";
import { getKvClient } from "@/lib/kv";
import { Order, calculateGrossProfit } from "@/lib/data";

const ORDERS_KEY = "diecast:orders";

function checkAuth(request: NextRequest): boolean {
  const token = request.cookies.get("auth_token")?.value;
  return token === process.env.APP_PASSWORD;
}

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

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const kv = getKvClient();
    const orders = (await kv.get<Order[]>(ORDERS_KEY)) || [];
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
    const newOrder: Order = {
      ...body,
      id: crypto.randomUUID(),
      grossProfit: calculateGrossProfit(body),
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
    const updatedOrder: Order = {
      ...body,
      grossProfit: calculateGrossProfit(body),
      updatedAt: new Date().toISOString(),
      createdAt: orders[index].createdAt,
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
