"use client";

import { Order } from "@/lib/data";
import { FIELD_LABELS } from "@/lib/labels";
import { Download, Upload, FileSpreadsheet } from "lucide-react";

export function ImportExport({ orders, onImport }: { orders: Order[]; onImport: () => void }) {
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(orders, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `模型车销售-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  };

  const exportCSV = () => {
    const headers = [
      FIELD_LABELS.orderId,
      FIELD_LABELS.dateSold,
      FIELD_LABELS.customer,
      FIELD_LABELS.model,
      FIELD_LABELS.brand,
      FIELD_LABELS.scale,
      FIELD_LABELS.status,
      FIELD_LABELS.purchaseCost,
      FIELD_LABELS.airFreight,
      FIELD_LABELS.tradeMeFee,
      FIELD_LABELS.shippingCharge,
      FIELD_LABELS.courierCost,
      FIELD_LABELS.sellingPrice,
      FIELD_LABELS.grossProfit,
      FIELD_LABELS.tracking,
      FIELD_LABELS.notes,
    ];
    const rows = orders.map((o) => [
      o.orderId, o.dateSold, o.customer, o.model, o.brand, o.scale, o.status,
      o.purchaseCost, o.airFreight, o.tradeMeFee, o.shippingCharge, o.courierCost,
      o.sellingPrice, o.grossProfit, o.tracking, o.notes,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `模型车销售-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
  };

  const importJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target?.result as string);
        if (Array.isArray(data)) {
          for (const order of data) {
            await fetch("/api/orders", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(order),
            });
          }
          onImport();
        }
      } catch {
        alert("JSON 文件格式无效");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={exportJSON} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm">
        <Download className="w-4 h-4" /> 导出 JSON
      </button>
      <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm">
        <FileSpreadsheet className="w-4 h-4" /> 导出 CSV
      </button>
      <label className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 transition text-sm cursor-pointer">
        <Upload className="w-4 h-4" /> 导入 JSON
        <input type="file" accept=".json" onChange={importJSON} className="hidden" />
      </label>
    </div>
  );
}
