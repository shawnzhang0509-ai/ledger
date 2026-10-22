"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { LOCATIONS, STOCK_LABELS, STOCK_STATUS, StockLine, StockReport, StockStatus } from "@/lib/stock";
import { calculatePurchaseCostNzd } from "@/lib/data";
import { Edit2, Plus, RefreshCw, Trash2, X } from "lucide-react";

// Every car from bought to sold: where it is, what it cost to land, which sale it went to.
// Same numbers the bots send as a card (`dt stock card`). Selling and returns go through the bots
// (`dt stock sell|return`), so the cost moves into or out of the books exactly once.
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
type Filter = "unsold" | StockStatus | "all";

export default function StockPage() {
  return (
    <AuthGate>
      <StockContent />
    </AuthGate>
  );
}

function StockContent() {
  const [s, setS] = useState<StockReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("unsold");
  const [editing, setEditing] = useState<Partial<StockLine> | null>(null);
  const load = () => {
    setError(null);
    fetch("/api/stock/report", { cache: "no-store" })
      .then(async (r) => (r.ok ? setS(await r.json()) : setError(`读取失败（${r.status}）`)))
      .catch(() => setError("无法连接服务器"));
  };
  useEffect(load, []);

  const save = async (item: Partial<StockLine>) => {
    const r = await fetch("/api/stock", { method: item.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(item) });
    if (!r.ok) return alert(`保存失败：${(await r.json().catch(() => ({}))).error || r.status}`);
    setEditing(null);
    load();
  };
  const remove = async (i: StockLine) => {
    if (!confirm(`删除「${i.model}」这条库存记录？（只删库存这一行，不动账本）`)) return;
    await fetch(`/api/stock?id=${i.id}`, { method: "DELETE" });
    load();
  };

  if (error) return <div className="p-8 text-red-700">{error}</div>;
  if (!s) return <div className="p-8 text-slate-500">加载中…</div>;
  const t = s.totals;
  const shown = s.items.filter((i) => filter === "all" || (filter === "unsold" ? i.status !== "Sold" : i.status === filter));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">库存</h1>
            <p className="text-slate-500 text-sm mt-1">每台车：在哪 · 落地成本 · 卖给了哪一单</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <a href="/" className="text-slate-500 hover:text-slate-800">订单</a>
            <a href="/books" className="text-slate-500 hover:text-slate-800">账本</a>
            <button onClick={load} className="flex items-center gap-1 text-slate-500 hover:text-slate-800"><RefreshCw className="w-4 h-4" />刷新</button>
            <button onClick={() => setEditing({ status: "InStock", location: "NZ" })}
              className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-700"><Plus className="w-4 h-4" />登记一台</button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="在库台数" value={`${t.inStock} 台`} />
          <Kpi label="在库成本（落地）" value={money(t.stockCost)} />
          <Kpi label="已上架" value={`${t.listed} 台`} />
          <Kpi label="本月售出" value={`${t.soldThisMonth} 台`} tone="green" />
        </div>

        {s.flags.length > 0 && (
          <Box title={`需要核对（${s.flags.length} 条）`} tone="amber">
            <ul className="list-disc ml-5 space-y-1 text-sm text-slate-700">
              {s.flags.map((f, n) => <li key={n}><a href={`#${f.id}`} className="font-medium text-slate-800 hover:underline">{f.model}</a>：{f.flag}</li>)}
            </ul>
          </Box>
        )}

        <Box title="逐台明细">
          <div className="flex flex-wrap gap-2 mb-3 text-sm">
            {(["unsold", ...STOCK_STATUS, "all"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-full border ${filter === f ? "bg-slate-900 text-white border-slate-900" : "border-slate-300 text-slate-600 hover:bg-white"}`}>
                {f === "unsold" ? "未售" : f === "all" ? "全部" : STOCK_LABELS[f]}
                {f !== "all" && f !== "unsold" && ` ${t.byStatus[f].count}`}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  {["车型", "货号", "状态", "在哪", "进货", "空运", "快递", "落地成本", "进货日", "Trade Me", "销售单", ""].map((h) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {shown.map((i) => (
                  <tr key={i.id} id={i.id} className={`border-b last:border-0 ${i.flags.length ? "bg-amber-50" : ""}`}>
                    <td className="py-2 pr-4 max-w-[300px] truncate" title={i.notes}>{i.model}<span className="text-slate-400"> {[i.brand, i.scale].filter(Boolean).join(" ")}</span></td>
                    <td className="pr-4">{i.ref || <span className="text-amber-600">缺</span>}</td>
                    <td className="pr-4">{STOCK_LABELS[i.status]}</td>
                    <td className="pr-4 text-slate-500">{i.location || "—"}</td>
                    <td className="pr-4">{i.purchaseCost ? money(i.purchaseCost) : <span className="text-amber-600">缺</span>}</td>
                    <td className="pr-4">{money(i.airFreight)}</td>
                    <td className="pr-4">{money(i.courierCost)}</td>
                    <td className="pr-4 font-medium">{money(i.landedCost)}</td>
                    <td className="pr-4 text-slate-500">{i.acquiredAt || "—"}</td>
                    <td className="pr-4">{i.listingId ? <a className="text-blue-700 hover:underline" href={`https://www.trademe.co.nz/a/listing/${i.listingId}`} target="_blank" rel="noopener noreferrer">{i.listingId}</a> : "—"}</td>
                    <td className="pr-4">{i.orderId || (i.returnedFrom ? <span className="text-slate-500">退回自 {i.returnedFrom}</span> : "—")}</td>
                    <td className="pr-2">
                      <button onClick={() => setEditing(i)} className="p-1 text-slate-400 hover:text-slate-800" title="编辑"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => remove(i)} className="p-1 text-slate-400 hover:text-red-600" title="删除"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
                {!shown.length && <tr><td colSpan={12} className="py-6 text-center text-slate-400">没有记录</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">落地成本 = 进货价（人民币 ÷ 汇率）+ 空运 + 快递。卖出、退货请让机器人做（dt stock sell / return），成本会带进或带出那条销售，账本里只算一次。</p>
        </Box>
      </div>
      {editing && <StockForm item={editing} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function StockForm({ item, onSave, onClose }: { item: Partial<StockLine>; onSave: (i: Partial<StockLine>) => void; onClose: () => void }) {
  const [f, setF] = useState<Partial<StockLine>>(item);
  const set = (k: keyof StockLine, v: string | number) => setF((p) => ({ ...p, [k]: v }));
  const num = (k: keyof StockLine) => ({ type: "number", step: "0.01", min: 0, value: (f[k] as number) ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value === "" ? 0 : Number(e.target.value)) });
  const txt = (k: keyof StockLine) => ({ value: (f[k] as string) ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value) });
  const fromCny = calculatePurchaseCostNzd(Number(f.purchaseCostCny) || 0, Number(f.exchangeRate) || 0);
  const purchase = fromCny || Number(f.purchaseCost) || 0;
  const landed = purchase + (Number(f.airFreight) || 0) + (Number(f.courierCost) || 0);
  const input = "w-full px-3 py-2 border border-slate-300 rounded-lg text-sm";
  const field = (label: string, el: React.ReactNode) => <label className="block text-sm"><span className="text-slate-600">{label}</span>{el}</label>;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, purchaseCost: purchase }); }}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{f.id ? "编辑库存" : "登记一台车"}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {field("车型 *", <input required className={input} {...txt("model")} />)}
          {field("货号", <input className={input} {...txt("ref")} />)}
          {field("品牌", <input className={input} {...txt("brand")} />)}
          {field("比例", <input className={input} placeholder="1:18" {...txt("scale")} />)}
          {field("进货价（人民币）", <input className={input} {...num("purchaseCostCny")} />)}
          {field("汇率（1 NZD = ? CNY）", <input className={input} {...num("exchangeRate")} step="0.0001" />)}
          {field("进货价（NZ$，没有人民币时填）", <input className={input} {...num("purchaseCost")} disabled={fromCny > 0} />)}
          {field("空运（NZ$）", <input className={input} {...num("airFreight")} />)}
          {field("快递 / 回程运费（NZ$）", <input className={input} {...num("courierCost")} />)}
          {field("状态", <select className={input} value={f.status} onChange={(e) => set("status", e.target.value)}>
            {STOCK_STATUS.map((st) => <option key={st} value={st}>{STOCK_LABELS[st]}</option>)}</select>)}
          {field("在哪", <select className={input} value={f.location} onChange={(e) => set("location", e.target.value)}>
            {LOCATIONS.map((l) => <option key={l} value={l}>{l}</option>)}</select>)}
          {field("进货日期", <input type="date" className={input} {...txt("acquiredAt")} />)}
          {field("Trade Me listing id", <input className={input} {...txt("listingId")} />)}
          {field("销售单号（KP-…）", <input className={input} {...txt("orderId")} />)}
        </div>
        {field("备注", <textarea className={input} rows={2} value={f.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />)}
        <div className="flex items-center justify-between pt-2">
          <span className="text-sm text-slate-600">落地成本：<b>{money(Math.round(landed * 100) / 100)}</b></span>
          <button className="px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 text-sm">保存</button>
        </div>
      </form>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "green" }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
      <div className="text-sm text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-bold ${tone === "green" ? "text-emerald-600" : "text-slate-900"}`}>{value}</div>
    </div>
  );
}

function Box({ title, tone, children }: { title: string; tone?: "amber"; children: React.ReactNode }) {
  return (
    <section className={`p-4 rounded-xl shadow-sm border ${tone === "amber" ? "bg-amber-50/60 border-amber-200" : "bg-white border-slate-200"}`}>
      <h2 className="font-semibold text-slate-800 mb-3">{title}</h2>
      {children}
    </section>
  );
}
