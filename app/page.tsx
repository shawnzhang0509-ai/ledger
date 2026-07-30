"use client";

import { useState } from "react";
import { useOrders } from "@/hooks/use-orders";
import { AuthGate } from "@/components/auth-gate";
import { StatsCards } from "@/components/stats-cards";
import { OrderForm } from "@/components/order-form";
import { ImportExport } from "@/components/import-export";
import { Order, STATUS_OPTIONS, SAMPLE_ORDERS } from "@/lib/data";
import { FIELD_LABELS, getStatusLabel } from "@/lib/labels";
import { Plus, Search, Trash2, Edit2, Filter, Package } from "lucide-react";

const TABLE_COLUMNS = [
  { key: "orderId", label: FIELD_LABELS.orderId },
  { key: "dateSold", label: FIELD_LABELS.dateSold },
  { key: "customer", label: FIELD_LABELS.customer },
  { key: "model", label: FIELD_LABELS.model },
  { key: "brand", label: FIELD_LABELS.brand },
  { key: "scale", label: FIELD_LABELS.scale },
  { key: "status", label: FIELD_LABELS.status },
  { key: "sellingPrice", label: FIELD_LABELS.sellingPrice },
  { key: "grossProfit", label: FIELD_LABELS.grossProfit },
] as const;

function statusBadgeClass(status: Order["status"]) {
  switch (status) {
    case "Completed":
      return "bg-emerald-100 text-emerald-700";
    case "Cancelled":
      return "bg-red-100 text-red-700";
    case "Shipped":
      return "bg-blue-100 text-blue-700";
    case "Paid":
      return "bg-violet-100 text-violet-700";
    default:
      return "bg-amber-100 text-amber-700";
  }
}

export default function Home() {
  return (
    <AuthGate>
      <HomeContent />
    </AuthGate>
  );
}

function HomeContent() {
  const { orders, loading, error, createOrder, updateOrder, deleteOrder, refresh } = useOrders();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [sortBy, setSortBy] = useState<string>("dateSold");
  const [sortDesc, setSortDesc] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);

  const filteredOrders = orders
    .filter((o) => {
      const matchesSearch =
        !search ||
        o.orderId.toLowerCase().includes(search.toLowerCase()) ||
        o.customer.toLowerCase().includes(search.toLowerCase()) ||
        o.model.toLowerCase().includes(search.toLowerCase()) ||
        o.brand.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "All" || o.status === statusFilter;
      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      let valA = a[sortBy as keyof Order];
      let valB = b[sortBy as keyof Order];
      if (typeof valA === "string") valA = valA.toLowerCase();
      if (typeof valB === "string") valB = valB.toLowerCase();
      if (valA < valB) return sortDesc ? 1 : -1;
      if (valA > valB) return sortDesc ? -1 : 1;
      return 0;
    });

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(field);
      setSortDesc(true);
    }
  };

  const handleSubmit = async (formData: any) => {
    if (editingOrder) {
      await updateOrder(formData);
    } else {
      await createOrder(formData);
    }
    setShowForm(false);
    setEditingOrder(null);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定删除此订单？")) return;
    await deleteOrder(id);
  };

  const addSampleData = async () => {
    for (const sample of SAMPLE_ORDERS) {
      await createOrder(sample);
    }
  };

  const SortIcon = ({ field }: { field: string }) => {
    if (sortBy !== field) return <span className="text-slate-300 ml-1">↕</span>;
    return <span className="text-slate-600 ml-1">{sortDesc ? "↓" : "↑"}</span>;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-slate-500">加载中...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white border border-red-200 text-red-600 rounded-xl p-6 max-w-md text-center shadow-sm">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">模型车销售记账</h1>
            <p className="text-slate-500 text-sm mt-1">订单管理 · 利润统计 · 数据导入导出</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ImportExport orders={orders} onImport={refresh} />
            <button
              onClick={() => { setEditingOrder(null); setShowForm(true); }}
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition font-medium shadow-sm"
            >
              <Plus className="w-4 h-4" /> 新增订单
            </button>
          </div>
        </div>

        <StatsCards orders={orders} />

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 mb-6 overflow-hidden">
          <div className="p-4 flex flex-col sm:flex-row gap-3 border-b border-slate-100">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="搜索订单编号、客户、车型、品牌..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-slate-500 shrink-0" />
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 text-sm"
              >
                <option value="All">全部状态</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>{getStatusLabel(s)}</option>
                ))}
              </select>
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="p-16 text-center">
              <div className="inline-flex p-4 bg-slate-100 rounded-full mb-4">
                <Package className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-slate-500 mb-4">暂无订单数据</p>
              <button
                onClick={addSampleData}
                className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition text-sm font-medium"
              >
                添加示例数据
              </button>
            </div>
          ) : (
            <>
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      {TABLE_COLUMNS.map((col) => (
                        <th
                          key={col.key}
                          onClick={() => handleSort(col.key)}
                          className="px-4 py-3 text-left font-medium text-slate-700 cursor-pointer hover:bg-slate-100 select-none whitespace-nowrap"
                        >
                          {col.label}
                          <SortIcon field={col.key} />
                        </th>
                      ))}
                      <th className="px-4 py-3 text-right font-medium text-slate-700">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredOrders.map((order) => (
                      <tr key={order.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs">{order.orderId}</td>
                        <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{order.dateSold}</td>
                        <td className="px-4 py-3">{order.customer}</td>
                        <td className="px-4 py-3 max-w-xs truncate" title={order.model}>{order.model}</td>
                        <td className="px-4 py-3">{order.brand}</td>
                        <td className="px-4 py-3 text-slate-500">{order.scale}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(order.status)}`}>
                            {getStatusLabel(order.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">${order.sellingPrice.toFixed(2)}</td>
                        <td className={`px-4 py-3 font-medium whitespace-nowrap ${order.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          ${order.grossProfit.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setEditingOrder(order); setShowForm(true); }}
                              className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                              title="编辑"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(order.id)}
                              className="p-1.5 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="删除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="lg:hidden divide-y divide-slate-100">
                {filteredOrders.map((order) => (
                  <div key={order.id} className="p-4">
                    <div className="flex items-start justify-between mb-2 gap-3">
                      <div className="min-w-0">
                        <div className="font-mono text-xs text-slate-500">{order.orderId}</div>
                        <div className="font-medium truncate">{order.model}</div>
                        <div className="text-sm text-slate-600">{order.customer} · {order.brand} · {order.scale}</div>
                      </div>
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${statusBadgeClass(order.status)}`}>
                        {getStatusLabel(order.status)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <div className="text-slate-500">{order.dateSold}</div>
                      <div className="flex items-center gap-3">
                        <span>售价: <span className="font-medium">${order.sellingPrice.toFixed(2)}</span></span>
                        <span className={order.grossProfit >= 0 ? "text-emerald-600" : "text-red-600"}>
                          毛利: ${order.grossProfit.toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => { setEditingOrder(order); setShowForm(true); }}
                        className="flex-1 py-1.5 text-sm border border-slate-300 rounded-lg hover:bg-slate-50 transition"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => handleDelete(order.id)}
                        className="flex-1 py-1.5 text-sm border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="text-center text-sm text-slate-400">
          共 {filteredOrders.length} 条订单
          {statusFilter !== "All" && `（筛选：${getStatusLabel(statusFilter as Order["status"])}）`}
        </div>
      </div>

      {showForm && (
        <OrderForm
          order={editingOrder}
          onSubmit={handleSubmit}
          onClose={() => { setShowForm(false); setEditingOrder(null); }}
        />
      )}
    </div>
  );
}
