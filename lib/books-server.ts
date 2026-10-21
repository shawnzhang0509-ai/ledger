import { getKvClient } from "@/lib/kv";
import { Order, normalizeOrderInput } from "@/lib/data";
import { booksReport } from "@/lib/books";
import { STOCK_KEY, StockItem, normalizeStock, stockReport } from "@/lib/stock";

const ORDERS_KEY = "diecast:orders";

export async function loadStock() {
  return ((await getKvClient().get<StockItem[]>(STOCK_KEY)) || []).map(normalizeStock);
}

export async function loadBooks() {
  const [orders, stock] = await Promise.all([getKvClient().get<Order[]>(ORDERS_KEY), loadStock()]);
  return booksReport((orders || []).map((o) => normalizeOrderInput(o)), new Date(), stock);
}

export async function loadStockReport() {
  return stockReport(await loadStock());
}
