import { getKvClient } from "@/lib/kv";
import { Order, normalizeOrderInput } from "@/lib/data";
import { booksReport } from "@/lib/books";

const ORDERS_KEY = "diecast:orders";

export async function loadBooks() {
  const orders = ((await getKvClient().get<Order[]>(ORDERS_KEY)) || []).map((o) => normalizeOrderInput(o));
  return booksReport(orders);
}
