"use client";

import { useEffect, useState } from "react";
import { useOrders } from "@/hooks/use-orders";
import { AuthGate } from "@/components/auth-gate";
import { DeliveryCycle } from "@/components/delivery-cycle";
import { booksReport } from "@/lib/books";
import { photoFor, type ProductPhoto } from "@/lib/product-photo";
import { OrderForm } from "@/components/order-form";
import { ImportExport } from "@/components/import-export";
import { Order, STATUS_OPTIONS, SAMPLE_ORDERS } from "@/lib/data";
import { getStatusLabel } from "@/lib/labels";
import {
  Activity, AlertCircle, BookOpen, Bot, Boxes, Camera, DollarSign, LineChart, MoreHorizontal, Package, Plus, Search,
  ShoppingBag, Tag, TrendingUp, Trash2, Users, type LucideIcon,
} from "lucide-react";

const STATUS_DOT: Record<Order["status"], string> = {
  Pending: "#d97706", Paid: "#7c3aed", Shipped: "#2563eb", Completed: "#16a34a", Cancelled: "#a8a397",
};
const short = (n: number) => (Math.abs(n) >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${Math.round(n)}`);

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
  const [missingOnly, setMissingOnly] = useState(false);
  const [tools, setTools] = useState(false);
  const [products, setProducts] = useState<ProductPhoto[]>([]);
  useEffect(() => {
    fetch("/api/products").then((r) => (r.ok ? r.json() : [])).then(setProducts).catch(() => {});
  }, []);
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
    .sort((a, b) => (b.dateSold || "").localeCompare(a.dateSold || ""));

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

  const books = booksReport(orders);
  const line = Object.fromEntries(books.lines.map((l) => [l.orderId, l]));
  const t = books.totals;
  const counts = Object.fromEntries(STATUS_OPTIONS.map((st) => [st, orders.filter((o) => o.status === st).length]));
  const missingCount = books.lines.filter((l) => l.missing.length && l.status !== "Cancelled").length;
  const shown = missingOnly ? filteredOrders.filter((o) => line[o.orderId]?.missing.length && o.status !== "Cancelled") : filteredOrders;

  // Read at a glance (owner 2026-11-27, dyslexia: 「这个UI是什么鬼」): car photos, big numbers, colour; ink and orange like
  // brain and /ops. A sale still missing a cost says so instead of a profit that counts the blank as 0.
  return (
    <div className="min-h-screen bg-[#f5f3ee] text-[#16161a]">
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-28 lg:px-8 space-y-6">
        <header className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[30px] font-extrabold tracking-tight">订单</h1>
            <button onClick={() => setTools(!tools)} aria-label="导入导出" aria-expanded={tools}
              className={`flex items-center justify-center w-11 h-11 rounded-full ${tools ? "bg-[#16161a] text-white" : "bg-white"}`}>
              <MoreHorizontal className="w-5 h-5" />
            </button>
          </div>
          {tools && <ImportExport orders={orders} onImport={refresh} />}
          <nav className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 [scrollbar-width:none]">
            {([["/books", "账本", BookOpen], ["/stock", "库存", Boxes], ["/split", "分账", Users], ["/ops", "运营", Activity],
               ["/catalog", "商品", Tag], ["/market", "市场", LineChart], ["/photos", "照片", Camera], ["/team", "bot", Bot]] as [string, string, LucideIcon][]).map(([href, name, I]) => (
              <a key={href} href={href} className="flex shrink-0 items-center gap-1.5 h-10 px-4 rounded-full bg-white font-semibold active:opacity-70">
                <I className="w-4 h-4 text-[#c2410c]" />{name}
              </a>
            ))}
          </nav>
        </header>

        <section className="grid grid-cols-3 gap-2" aria-label="合计">
          <Big icon={ShoppingBag} n={String(t.orders)} label="单" />
          <Big icon={DollarSign} n={short(t.revenue)} label="卖了" />
          <Big icon={TrendingUp} n={short(t.completeGp)} label={`赚了${t.marginPct == null ? "" : ` · ${t.marginPct.toFixed(0)}%`}`} good />
        </section>

        {missingCount > 0 && (
          <button onClick={() => setMissingOnly(!missingOnly)} aria-pressed={missingOnly}
            className={`w-full flex items-center gap-3 rounded-[24px] px-4 py-3.5 text-left ${missingOnly ? "bg-[#c2410c] text-white" : "bg-[#fde8dc] text-[#9a3412]"}`}>
            <AlertCircle className="w-7 h-7 shrink-0" />
            <span className="flex-1">
              <span className="block text-lg font-extrabold">{missingCount} 单缺成本</span>
              <span className="block text-sm font-medium opacity-90">利润只算了 {t.complete}/{t.orders} 单 · {missingOnly ? "点这里看全部" : "点这里只看这些"}</span>
            </span>
          </button>
        )}

        <DeliveryCycle orders={orders} />

        <section className="space-y-3" aria-label="订单列表">
          <div className="flex items-center gap-2 h-12 px-4 rounded-full bg-white">
            <Search className="w-5 h-5 text-[#5e5b55] shrink-0" />
            <input type="search" placeholder="车型、客户、单号" value={search} onChange={(e) => setSearch(e.target.value)}
              className="flex-1 min-w-0 bg-transparent text-base outline-none placeholder:text-[#a8a397]" />
          </div>
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 [scrollbar-width:none]">
            {(["All", ...STATUS_OPTIONS] as string[]).map((st) => (
              <button key={st} onClick={() => setStatusFilter(st)} aria-pressed={statusFilter === st}
                className={`flex shrink-0 items-center gap-1.5 h-10 px-4 rounded-full font-semibold ${statusFilter === st ? "bg-[#16161a] text-white" : "bg-white"}`}>
                {st !== "All" && <span className="w-2.5 h-2.5 rounded-full" style={{ background: STATUS_DOT[st as Order["status"]] }} />}
                {st === "All" ? "全部" : getStatusLabel(st as Order["status"])}
                <span className="opacity-60 tabular-nums">{st === "All" ? orders.length : counts[st]}</span>
              </button>
            ))}
          </div>

          {orders.length === 0 ? (
            <div className="rounded-[24px] bg-white p-12 text-center space-y-4">
              <Package className="w-10 h-10 mx-auto text-[#a8a397]" />
              <button onClick={addSampleData} className="h-11 px-5 rounded-full bg-[#16161a] text-white font-semibold">添加示例数据</button>
            </div>
          ) : (
            <div className="grid lg:grid-cols-2 gap-3">
              {shown.map((order) => {
                const l = line[order.orderId];
                const missing = order.status !== "Cancelled" && l?.missing.length ? l.missing : null;
                return (
                  <div key={order.id} className={`relative rounded-[24px] bg-white ${order.status === "Cancelled" ? "opacity-50" : ""}`}>
                    <button onClick={() => { setEditingOrder(order); setShowForm(true); }} aria-label={`编辑 ${order.model}`}
                      className="w-full flex gap-3 p-3 pr-12 text-left active:bg-[#ece8e0] rounded-[24px]">
                      <Photo src={photoFor(products, order.model)} />
                      <span className="flex-1 min-w-0 flex flex-col gap-1">
                        <span className="font-semibold leading-snug line-clamp-2">{order.model || order.orderId}</span>
                        <span className="flex items-center gap-1.5 text-sm text-[#5e5b55]">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: STATUS_DOT[order.status] }} />
                          {getStatusLabel(order.status)} · {order.dateSold.slice(5)}
                        </span>
                        <span className="flex items-baseline gap-3 flex-wrap">
                          <span className="text-xl font-extrabold tabular-nums">${order.sellingPrice.toFixed(0)}</span>
                          {missing ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-[#fde8dc] px-2.5 py-0.5 text-sm font-semibold text-[#9a3412]">
                              <AlertCircle className="w-4 h-4" />缺{missing.join("、")}
                            </span>
                          ) : order.status === "Cancelled" ? null : (
                            <span className={`text-lg font-bold tabular-nums ${order.grossProfit >= 0 ? "text-[#15803d]" : "text-[#c2410c]"}`}>
                              赚 ${order.grossProfit.toFixed(0)}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <button onClick={() => handleDelete(order.id)} aria-label={`删除 ${order.model}`}
                      className="absolute top-2 right-2 flex items-center justify-center w-10 h-10 rounded-full text-[#a8a397] active:bg-[#fde8dc] active:text-[#c2410c]">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          <div className="text-center text-sm text-[#5e5b55]">{shown.length} 单</div>
        </section>
      </div>

      <button onClick={() => { setEditingOrder(null); setShowForm(true); }} aria-label="新增订单"
        className="fixed bottom-6 right-5 flex items-center gap-2 h-14 px-6 rounded-full bg-[#c2410c] text-white text-lg font-bold shadow-lg active:opacity-80">
        <Plus className="w-6 h-6" />新增
      </button>

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

function Big({ icon: I, n, label, good }: { icon: LucideIcon; n: string; label: string; good?: boolean }) {
  return (
    <div className="rounded-[24px] bg-white p-3.5 flex flex-col gap-0.5 min-w-0">
      <I className={`w-6 h-6 ${good ? "text-[#15803d]" : "text-[#c2410c]"}`} />
      <span className={`text-[26px] leading-tight font-extrabold tabular-nums truncate ${good ? "text-[#15803d]" : ""}`}>{n}</span>
      <span className="text-sm font-semibold text-[#5e5b55] truncate">{label}</span>
    </div>
  );
}

function Photo({ src }: { src: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" className="w-20 h-20 shrink-0 rounded-2xl bg-[#ece8e0] object-cover" />
  ) : (
    <span className="flex w-20 h-20 shrink-0 items-center justify-center rounded-2xl bg-[#ece8e0]"><Package className="w-7 h-7 text-[#a8a397]" /></span>
  );
}
