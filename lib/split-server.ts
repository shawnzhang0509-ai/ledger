import { loadBooks } from "@/lib/books-server";
import { loadSplitEntries } from "@/lib/split-db";
import { splitReport } from "@/lib/split";

// 分账 from the records and the books; the /split page, its card and the 总览 line all read this.
export async function loadSplitReport() {
  const [rows, books] = await Promise.all([loadSplitEntries(), loadBooks()]);
  const lines = books.lines.filter((l) => l.status !== "Cancelled");
  const salesIn = lines.reduce((t, l) => t + l.price + l.shipping - l.fee, 0);
  const costs = lines.reduce((t, l) => t + l.purchase + l.air + l.courier, 0);
  return splitReport(rows, salesIn, costs);
}
