"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { MarketSnapshot, RADAR_LABELS, REF_LABELS } from "@/lib/market";
import { RefreshCw } from "lucide-react";

// Same-car prices elsewhere, demand per car family, 新品雷达. Computed in driftae-ops (`dt market push`, every 30 min);
// the bots send the same numbers as cards (`dt market card`). Recording prices, refs and 要/不要 goes through the bots.
const nz = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-NZ")}`);
type Tab = "prices" | "demand" | "radar";
const TABS: [Tab, string][] = [["prices", "同款比价"], ["demand", "车系需求"], ["radar", "新品雷达"]];

export default function MarketPage() {
  return (
    <AuthGate>
      <MarketContent />
    </AuthGate>
  );
}

function MarketContent() {
  const [s, setS] = useState<MarketSnapshot | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("prices");
  const load = () => {
    setError(null);
    fetch("/api/market", { cache: "no-store" })
      .then(async (r) => (r.ok ? setS((await r.json()).snapshot) : setError(`读取失败（${r.status}）`)))
      .catch(() => setError("无法连接服务器"));
  };
  useEffect(load, []);

  if (error) return <div className="p-8 text-red-700">{error}</div>;
  if (s === undefined) return <div className="p-8 text-slate-500">加载中…</div>;
  if (s === null) return <div className="p-8 text-slate-500">还没有数据：服务器每 30 分钟推一次（dt market push）。</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">市场</h1>
            <p className="text-slate-500 text-sm mt-1">截至 {new Date(s.built).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland" })} · 记价格、货号、要不要都跟 bot 说</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <a href="/" className="text-slate-500 hover:text-slate-800">订单</a>
            <a href="/stock" className="text-slate-500 hover:text-slate-800">库存</a>
            <a href="/catalog" className="text-slate-500 hover:text-slate-800">商品与价格</a>
            <button onClick={load} className="flex items-center gap-1 text-slate-500 hover:text-slate-800"><RefreshCw className="w-4 h-4" />刷新</button>
          </div>
        </div>
        <div className="flex gap-2">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === id ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-700"}`}>{label}</button>
          ))}
        </div>
        {tab === "prices" && <Prices s={s} />}
        {tab === "demand" && <Demand s={s} />}
        {tab === "radar" && <Radar s={s} />}
      </div>
    </div>
  );
}

function Prices({ s }: { s: MarketSnapshot }) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="货号已确认" value={`${s.refs.confirmed} 台`} />
        <Kpi label="货号待核对" value={`${s.refs.candidate} 台`} />
        <Kpi label="货号未知" value={`${s.refs.unknown} 台`} />
        <Kpi label="有别家价格" value={`${s.prices.filter((p) => p.lowest_elsewhere_nzd != null).length} 台`} />
      </div>
      <Box title="我们 vs 别家（纽币；* 不含到 NZ 运费，? 还没人核对）">
        <Table head={["车", "货号", "我们", "别家最低", "差", "中位", "进货价", "别家"]}>
          {s.prices.map((p) => (
            <tr key={p.product} className="border-t border-slate-100">
              <td className="py-2 pr-3">{p.name}</td>
              <td className="pr-3 whitespace-nowrap">{p.ref ?? "—"} <span className="text-xs text-slate-400">{REF_LABELS[p.ref_status]}</span></td>
              <td className="pr-3">{nz(p.our_price)}</td>
              <td className="pr-3">{nz(p.lowest_elsewhere_nzd)}{p.lowest_without_shipping ? "*" : ""}</td>
              <td className={`pr-3 font-semibold ${(p.ours_vs_lowest_pct ?? 0) > 30 ? "text-red-600" : "text-emerald-600"}`}>
                {p.ours_vs_lowest_pct == null ? "—" : `${p.ours_vs_lowest_pct > 0 ? "+" : ""}${p.ours_vs_lowest_pct}%`}</td>
              <td className="pr-3">{nz(p.median_elsewhere_nzd)}</td>
              <td className="pr-3 text-slate-500">{nz(p.goods_cost_nzd)}</td>
              <td className="text-xs">
                {p.elsewhere.map((o) => (
                  <a key={o.id} href={o.url} target="_blank" rel="noreferrer" className="block text-blue-600 hover:underline">
                    {o.source} {nz(o.total_nzd)}{o.shipping_known ? "" : "*"}{o.status === "confirmed" ? "" : "?"} · {o.id}</a>
                ))}
                {p.trademe_others.map((t) => (
                  <a key={t.listing_id} href={`https://www.trademe.co.nz/a/${t.listing_id}`} target="_blank" rel="noreferrer" className="block text-blue-600 hover:underline">
                    Trade Me {nz(t.buy_now ?? t.start_price)}</a>
                ))}
              </td>
            </tr>
          ))}
        </Table>
      </Box>
    </>
  );
}

function Demand({ s }: { s: MarketSnapshot }) {
  const d = s.demand;
  return (
    <>
      <Box title={`车系（浏览、访客、咨询看近 ${d.days} 天，成交看近 ${d.sales_days} 天；数字小，只看方向）`}>
        <Table head={["车系", "台数", "TM 浏览", "收藏", "收藏率", "成交", "每台成交", "网站访客", "咨询", "广告对话", "每对话成本"]}>
          {d.families.map((f) => (
            <tr key={f.family} className="border-t border-slate-100">
              <td className="py-2 pr-3 font-medium">{f.label}</td><td className="pr-3">{f.products}</td><td className="pr-3">{f.tm_views}</td>
              <td className="pr-3">{f.tm_watchers}</td><td className="pr-3">{f.watch_rate_pct == null ? "—" : `${f.watch_rate_pct}%`}</td>
              <td className="pr-3">{f.sold}</td><td className="pr-3">{f.sold_per_product ?? "—"}</td><td className="pr-3">{f.site_visitors}</td>
              <td className="pr-3">{f.messenger_starts}</td><td className="pr-3">{f.ad_conversations}</td><td>{f.cost_per_conversation == null ? "—" : `$${f.cost_per_conversation}`}</td>
            </tr>
          ))}
        </Table>
      </Box>
      <Box title="单台车">
        <Table head={["车", "车系", "成交", "TM 浏览", "收藏", "网站访客", "咨询", "广告对话"]}>
          {d.products.map((p) => (
            <tr key={p.product} className="border-t border-slate-100">
              <td className="py-2 pr-3">{p.name}</td><td className="pr-3 text-slate-500">{d.families.find((f) => f.family === p.family)?.label ?? p.family}</td>
              <td className="pr-3">{p.sold}</td><td className="pr-3">{p.tm_views}</td><td className="pr-3">{p.tm_watchers}</td>
              <td className="pr-3">{p.site_visitors}</td><td className="pr-3">{p.messenger_starts}</td><td>{p.ad_conversations}</td>
            </tr>
          ))}
        </Table>
      </Box>
    </>
  );
}

function Radar({ s }: { s: MarketSnapshot }) {
  return (
    <Box title={`我们还没卖的车（回 bot「要 / 不要 <id>」「<id> 进货价 343」；预估毛利 = 同系现价中位数 − 进货价×汇率 − $${s.freight_est_nzd}）`}>
      {s.radar.length === 0 ? <p className="text-sm text-slate-500">还没有候选：bot 每周五 09:00 找一次。</p> : (
        <Table head={["id", "车", "货号", "车系", "海外", "同系我们卖", "进货价", "预估毛利", "状态", "为什么"]}>
          {s.radar.map((c) => (
            <tr key={c.id} className={`border-t border-slate-100 ${c.status === "dropped" ? "text-slate-400" : ""}`}>
              <td className="py-2 pr-3 font-mono text-xs">{c.id}</td>
              <td className="pr-3"><a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{c.brand} {c.name}</a>
                {c.release ? <span className="text-xs text-slate-400"> · {c.release}</span> : null}</td>
              <td className="pr-3">{c.ref}</td>
              <td className="pr-3">{s.demand.families.find((f) => f.family === c.family)?.label ?? c.family}</td>
              <td className="pr-3">{nz(c.overseas_nzd)}{c.overseas_nzd != null && !c.shipping_known ? "*" : ""}</td>
              <td className="pr-3">{nz(c.family_our_median_price)}</td>
              <td className="pr-3">{c.supplier_cny == null ? "—" : `¥${c.supplier_cny}`}</td>
              <td className="pr-3">{c.margin_est_nzd == null ? "缺进货价" : nz(c.margin_est_nzd)}</td>
              <td className="pr-3">{RADAR_LABELS[c.status]}</td>
              <td className="text-xs text-slate-500">{c.why ?? ""}</td>
            </tr>
          ))}
        </Table>
      )}
    </Box>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-slate-500">{head.map((h) => <th key={h} className="pb-2 pr-3 font-normal whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
      <div className="text-sm text-slate-500 mb-2">{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
    </div>
  );
}

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="p-4 rounded-xl shadow-sm border bg-white border-slate-200">
      <h2 className="font-semibold text-slate-800 mb-3">{title}</h2>
      {children}
    </section>
  );
}
