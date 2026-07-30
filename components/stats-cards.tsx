import { Order } from "@/lib/data";
import { Package, DollarSign, TrendingUp, Percent } from "lucide-react";

export function StatsCards({ orders }: { orders: Order[] }) {
  const totalOrders = orders.length;
  const totalSales = orders.reduce((sum, o) => sum + o.sellingPrice, 0);
  const totalProfit = orders.reduce((sum, o) => sum + o.grossProfit, 0);
  const avgMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;

  const stats = [
    { label: "总订单", value: totalOrders, icon: Package, color: "text-blue-600" },
    { label: "总销售额 (NZD)", value: `$${totalSales.toFixed(2)}`, icon: DollarSign, color: "text-emerald-600" },
    { label: "总毛利 (NZD)", value: `$${totalProfit.toFixed(2)}`, icon: TrendingUp, color: totalProfit >= 0 ? "text-emerald-600" : "text-red-600" },
    { label: "平均毛利率", value: `${avgMargin.toFixed(1)}%`, icon: Percent, color: avgMargin >= 0 ? "text-emerald-600" : "text-red-600" },
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
