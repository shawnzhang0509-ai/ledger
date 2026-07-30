"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Order, STATUS_OPTIONS, calculateGrossProfit } from "@/lib/data";
import { FIELD_LABELS, getStatusLabel } from "@/lib/labels";

type OrderFormData = Omit<Order, "id" | "grossProfit" | "createdAt" | "updatedAt">;

interface OrderFormProps {
  order?: Order | null;
  onSubmit: (order: any) => void;
  onClose: () => void;
}

const emptyOrder: OrderFormData = {
  orderId: "",
  dateSold: new Date().toISOString().split("T")[0],
  customer: "",
  model: "",
  brand: "",
  scale: "",
  status: "Pending",
  purchaseCost: 0,
  airFreight: 0,
  tradeMeFee: 0,
  shippingCharge: 0,
  courierCost: 0,
  sellingPrice: 0,
  tracking: "",
  notes: "",
};

const costFields = [
  "purchaseCost",
  "airFreight",
  "tradeMeFee",
  "shippingCharge",
  "courierCost",
  "sellingPrice",
] as const;

export function OrderForm({ order, onSubmit, onClose }: OrderFormProps) {
  const [form, setForm] = useState<OrderFormData>(emptyOrder);
  const [previewProfit, setPreviewProfit] = useState(0);

  useEffect(() => {
    if (order) {
      setForm({
        orderId: order.orderId,
        dateSold: order.dateSold,
        customer: order.customer,
        model: order.model,
        brand: order.brand,
        scale: order.scale,
        status: order.status,
        purchaseCost: order.purchaseCost,
        airFreight: order.airFreight,
        tradeMeFee: order.tradeMeFee,
        shippingCharge: order.shippingCharge,
        courierCost: order.courierCost,
        sellingPrice: order.sellingPrice,
        tracking: order.tracking,
        notes: order.notes,
      });
    } else {
      setForm(emptyOrder);
    }
  }, [order]);

  useEffect(() => {
    setPreviewProfit(calculateGrossProfit(form));
  }, [form]);

  const handleChange = (field: string, value: string | number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(order ? { ...form, id: order.id, createdAt: order.createdAt, updatedAt: order.updatedAt } : form);
  };

  const inputClass =
    "w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm";

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto border border-slate-200">
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <h2 className="text-lg font-bold">{order ? "编辑订单" : "新增订单"}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.orderId} *</label>
              <input required value={form.orderId} onChange={(e) => handleChange("orderId", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.dateSold} *</label>
              <input type="date" required value={form.dateSold} onChange={(e) => handleChange("dateSold", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.customer} *</label>
              <input required value={form.customer} onChange={(e) => handleChange("customer", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.model} *</label>
              <input required value={form.model} onChange={(e) => handleChange("model", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.brand} *</label>
              <input required value={form.brand} onChange={(e) => handleChange("brand", e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.scale}</label>
              <input value={form.scale} onChange={(e) => handleChange("scale", e.target.value)} placeholder="如 1:18" className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.status}</label>
              <select value={form.status} onChange={(e) => handleChange("status", e.target.value)} className={inputClass}>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {getStatusLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.tracking}</label>
              <input value={form.tracking} onChange={(e) => handleChange("tracking", e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {costFields.map((key) => (
              <div key={key}>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  {FIELD_LABELS[key]} (NZD)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form[key]}
                  onChange={(e) => handleChange(key, parseFloat(e.target.value) || 0)}
                  className={inputClass}
                />
              </div>
            ))}
          </div>

          <div className="bg-slate-50 p-4 rounded-xl flex items-center justify-between border border-slate-200">
            <span className="font-medium text-slate-700">预估毛利</span>
            <span className={`text-xl font-bold ${previewProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
              ${previewProfit.toFixed(2)}
            </span>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">{FIELD_LABELS.notes}</label>
            <textarea value={form.notes} onChange={(e) => handleChange("notes", e.target.value)} rows={2} className={inputClass} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="submit" className="flex-1 bg-slate-800 text-white py-2.5 rounded-lg hover:bg-slate-700 transition font-medium">
              {order ? "保存修改" : "创建订单"}
            </button>
            <button type="button" onClick={onClose} className="flex-1 bg-slate-100 text-slate-800 py-2.5 rounded-lg hover:bg-slate-200 transition font-medium">
              取消
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
