"use client";

import { Order } from "@/lib/data";
import { Download, Upload, FileSpreadsheet } from "lucide-react";

export function ImportExport({ orders, onImport }: { orders: Order[]; onImport: () => void }) {
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify(orders, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diecast-sales-${new Date().toISOString().split("T")[0]}.json`;
    a.click();
  };

  const exportCSV = () => {
    const headers = ["Order ID", "Date Sold", "Customer", "Model", "Brand", "Scale", "Status", "Purchase Cost", "Air Freight", "Trade Me Fee", "Shipping Charge", "Courier Cost", "Selling Price", "Gross Profit", "Tracking", "Notes"];
    const rows = orders.map((o) => [
      o.orderId, o.dateSold, o.customer, o.model, o.brand, o.scale, o.status,
      o.purchaseCost, o.airFreight, o.tradeMeFee, o.shippingCharge, o.courierCost,
      o.sellingPrice, o.grossProfit, o.tracking, o.notes,
    ]);
    const csv = [headers.join(","), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `diecast-sales-${new Date().toISOString().split("T")[0]}.csv`;
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
        alert("Invalid JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  return (
    <div className="flex gap-2">
      <button onClick={exportJSON} className="flex items-center gap-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition text-sm">
        <Download className="w-4 h-4" /> JSON
      </button>
      <button onClick={exportCSV} className="flex items-center gap-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition text-sm">
        <FileSpreadsheet className="w-4 h-4" /> CSV
      </button>
      <label className="flex items-center gap-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition text-sm cursor-pointer">
        <Upload className="w-4 h-4" /> 导入
        <input type="file" accept=".json" onChange={importJSON} className="hidden" />
      </label>
    </div>
  );
}
