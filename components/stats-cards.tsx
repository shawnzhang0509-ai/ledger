import { Order } from "@/lib/data";
import { booksReport } from "@/lib/books";
import { Package, DollarSign, TrendingUp, Percent } from "lucide-react";

// Profit counts only orders whose costs are all in; an order with blank costs would otherwise
// show its whole sale as profit. Breakdown on /books.
export function StatsCards({ orders }: { orders: Order[] }) {
  const t = booksReport(orders).totals;

  const stats = [
    { label: "总订单（不含已取消）", value: t.orders, icon: Package, color: "text-blue-600" },
    { label: "总销售额 (NZD，含运费)", value: `$${t.revenue.toFixed(2)}`, icon: DollarSign, color: "text-emerald-600" },
    { label: `已算清的毛利（${t.complete}/${t.orders} 单）`, value: `$${t.completeGp.toFixed(2)}`, icon: TrendingUp, color: t.completeGp >= 0 ? "text-emerald-600" : "text-red-600" },
    { label: "毛利率（算清的单）", value: t.marginPct == null ? "—" : `${t.marginPct.toFixed(1)}%`, icon: Percent, color: (t.marginPct ?? 0) >= 0 ? "text-emerald-600" : "text-red-600" },
  ];
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {stats.map((stat) => (
        <div key={stat.label} className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
          <div className="flex items-center gap-2 mb-2">
            <stat.icon className={`w-5 h-5 ${stat.color}`} />
            <span className="text-sm text-slate-500">{stat.label}</span>
          </div>
          <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
        </div>
      ))}
    </div>
  );
}
