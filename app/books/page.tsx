"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { BooksReport, BookLine } from "@/lib/books";
import { getStatusLabel } from "@/lib/labels";
import { RefreshCw } from "lucide-react";

// Each sale opened up: where the money went, which costs are still blank, what looks wrong.
// Same numbers the bots send as a card (`dt orders card`). Fix values on the 订单 page.
const SPLIT = [["purchase", "进货", "bg-indigo-400"], ["air", "空运", "bg-violet-400"], ["courier", "快递", "bg-cyan-500"],
  ["fee", "Trade Me", "bg-slate-400"], ["gp", "毛利", "bg-emerald-500"]] as const;
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;

export default function BooksPage() {
  return (
    <AuthGate>
      <BooksContent />
    </AuthGate>
  );
}

function BooksContent() {
  const [b, setB] = useState<BooksReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = () => {
    setError(null);
    fetch("/api/orders/report")
      .then(async (r) => (r.ok ? setB(await r.json()) : setError(`读取失败（${r.status}）`)))
      .catch(() => setError("无法连接服务器"));
  };
  useEffect(load, []);

  if (error) return <div className="p-8 text-red-700">{error}</div>;
  if (!b) return <div className="p-8 text-slate-500">加载中…</div>;
  const t = b.totals;
  const flagged = b.lines.filter((l) => l.flags.length);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">账本</h1>
            <p className="text-slate-500 text-sm mt-1">每单的钱花在哪 · 缺哪些成本 · 哪些数看着不对</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <a href="/" className="text-slate-500 hover:text-slate-800">订单</a>
            <a href="/stock" className="text-slate-500 hover:text-slate-800">库存</a>
            <a href="/ops" className="text-slate-500 hover:text-slate-800">运营看板</a>
            <button onClick={load} className="flex items-center gap-1 text-slate-500 hover:text-slate-800"><RefreshCw className="w-4 h-4" />刷新</button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="销售额（含运费）" value={money(t.revenue)} />
          <Kpi label={`已算清的毛利（${t.complete}/${t.orders} 单）`} value={t.complete ? money(t.completeGp) : "—"} tone={t.completeGp < 0 ? "red" : "green"} />
          <Kpi label="毛利率（算清的单）" value={t.marginPct == null ? "—" : `${t.marginPct}%`} />
          <Kpi label="缺成本" value={`${t.orders - t.complete} 单`} tone={t.orders - t.complete ? "amber" : "green"} />
        </div>

        <Box title="费用组成（成本齐全的单，占销售额）">
          {t.split ? (
            <>
              <div className="flex h-6 rounded overflow-hidden">
                {SPLIT.map(([k, , cls]) => <div key={k} className={cls} style={{ width: `${Math.max(0, t.split![k])}%` }} />)}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1 mt-3 text-sm text-slate-600">
                {SPLIT.map(([k, label, cls]) => (
                  <span key={k} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded-sm ${cls}`} />{label} {Math.round(t.split![k])}%</span>
                ))}
              </div>
            </>
          ) : (
            <p className="text-amber-700 text-sm">还没有成本齐全的单，算不出费用组成。补上进货价、汇率、空运费、快递成本就有了。</p>
          )}
        </Box>

        {flagged.length > 0 && (
          <Box title={`需要核对（${flagged.reduce((n, l) => n + l.flags.length, 0)} 条）`} tone="amber">
            <ul className="space-y-2 text-sm">
              {flagged.map((l) => (
                <li key={l.orderId}>
                  <span className="font-medium text-slate-800">{l.model || l.orderId}</span>
                  <span className="text-slate-400"> · {l.orderId}</span>
                  <ul className="list-disc ml-5 text-slate-700">{l.flags.map((f) => <li key={f}>{f}</li>)}</ul>
                </li>
              ))}
            </ul>
            <p className="text-xs text-slate-500 mt-3">机器人不会改已经填的数，请在「订单」页修改。</p>
          </Box>
        )}

        <Box title="逐单明细">
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm whitespace-nowrap">
              <thead>
                <tr className="text-left text-slate-500 border-b">
                  {["日期", "车型", "状态", "售价", "运费收入", "进货", "空运", "快递", "Trade Me", "毛利"].map((h) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {b.lines.map((l) => <Row key={l.orderId} l={l} />)}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500 mt-3">毛利 = 售价 + 运费收入 − 进货 − 空运 − 快递 − Trade Me 费。空格 = 还没填；缺成本的单不算进上面的毛利。</p>
        </Box>

        <Box title="按月">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-slate-500 border-b">{["月份", "单数", "销售额", "算清的单", "算清的毛利"].map((h) => <th key={h} className="py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {b.months.map((m) => (
                <tr key={m.month} className="border-b last:border-0">
                  <td className="py-2 pr-4">{m.month}</td><td className="pr-4">{m.orders}</td><td className="pr-4">{money(m.revenue)}</td>
                  <td className="pr-4">{m.complete}/{m.orders}</td><td className="pr-4">{m.complete ? money(m.completeGp) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </div>
    </div>
  );
}

function Row({ l }: { l: BookLine }) {
  const cost = (v: number, label: string) =>
    l.missing.includes(label) ? <span className="text-amber-600">缺</span> : money(v);
  return (
    <tr className={`border-b last:border-0 ${l.flags.length ? "bg-amber-50" : ""}`}>
      <td className="py-2 pr-4 text-slate-500">{l.dateSold}</td>
      <td className="pr-4 max-w-[280px] truncate" title={l.orderId}>
        {l.model || l.orderId}
        {l.stockId && <a href={`/stock#${l.stockId}`} className="ml-2 text-xs text-blue-700 hover:underline">{l.returned ? "已退回库存" : "来自库存"}</a>}
      </td>
      <td className="pr-4">{getStatusLabel(l.status)}</td>
      <td className="pr-4">{money(l.price)}</td>
      <td className="pr-4">{money(l.shipping)}</td>
      <td className="pr-4">{l.missing.includes("进货价") || l.missing.includes("汇率") ? <span className="text-amber-600">缺</span> : money(l.purchase)}</td>
      <td className="pr-4">{cost(l.air, "空运费")}</td>
      <td className="pr-4">{l.airDoor && !l.courier ? <span className="text-slate-500">空运门到门</span> : cost(l.courier, "快递成本")}</td>
      <td className="pr-4">{money(l.fee)}</td>
      <td className={`pr-4 font-medium ${!l.complete ? "text-slate-400" : l.gp < 0 ? "text-red-600" : "text-emerald-700"}`}>
        {l.complete ? money(l.gp) : "未算清"}
      </td>
    </tr>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "red" | "green" | "amber" }) {
  const color = tone === "red" ? "text-red-600" : tone === "green" ? "text-emerald-600" : tone === "amber" ? "text-amber-600" : "text-slate-900";
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
      <div className="text-sm text-slate-500 mb-2">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
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
