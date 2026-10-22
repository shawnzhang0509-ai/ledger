"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { MarketReport, RADAR_LABELS, REF_LABELS } from "@/lib/market";
import { RefreshCw } from "lucide-react";

// The market, kept here: Bay Hobbies and other prices for the same car, maker refs (货号), demand per car family,
// 新品雷达. People check and decide on this page; the bots do the same through /api/market/bot (`dt market …`) and
// send this page's numbers as cards (`dt market card`).
const nz = (n: number | null | undefined) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-NZ")}`);
type Tab = "prices" | "refs" | "demand" | "radar";
const TABS: [Tab, string][] = [["prices", "比价"], ["refs", "缺货号"], ["demand", "车系需求"], ["radar", "新品雷达"]];

async function act(body: Record<string, unknown>) {
  const r = await fetch("/api/market/bot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) alert(`没保存：${(await r.json().catch(() => ({}))).error || r.status}`);
  return r.ok;
}

export default function MarketPage() {
  return (
    <AuthGate>
      <MarketContent />
    </AuthGate>
  );
}

function MarketContent() {
  const [s, setS] = useState<MarketReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("prices");
  const load = () => {
    setError(null);
    fetch("/api/market", { cache: "no-store" })
      .then(async (r) => (r.ok ? setS(await r.json()) : setError(`读取失败（${r.status}）`)))
      .catch(() => setError("无法连接服务器"));
  };
  useEffect(load, []);
  const run = async (body: Record<string, unknown>) => { if (await act(body)) load(); };

  if (error) return <div className="p-8 text-red-700">{error}</div>;
  if (!s) return <div className="p-8 text-slate-500">加载中…</div>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">市场</h1>
            <p className="text-slate-500 text-sm mt-1">同款比价 · 货号 · 需求 · 选品。在这里点和跟 bot 说是一样的。</p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <a href="/" className="text-slate-500 hover:text-slate-800">订单</a>
            <a href="/stock" className="text-slate-500 hover:text-slate-800">库存</a>
            <a href="/catalog" className="text-slate-500 hover:text-slate-800">商品与价格</a>
            <button onClick={load} className="flex items-center gap-1 text-slate-500 hover:text-slate-800"><RefreshCw className="w-4 h-4" />刷新</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {TABS.map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${tab === id ? "bg-slate-900 text-white" : "bg-white border border-slate-300 text-slate-700"}`}>
              {label}{id === "refs" ? `（${s.missing_refs.length}）` : id === "prices" && s.unchecked_prices.length ? `（${s.unchecked_prices.length} 待核对）` : ""}</button>
          ))}
        </div>
        {tab === "prices" && <Prices s={s} run={run} />}
        {tab === "refs" && <Refs s={s} run={run} />}
        {tab === "demand" && <Demand s={s} />}
        {tab === "radar" && <Radar s={s} run={run} />}
      </div>
    </div>
  );
}

type Run = (body: Record<string, unknown>) => void;

function Prices({ s, run }: { s: MarketReport; run: Run }) {
  return (
    <>
      <p className="text-sm text-slate-500">
        Bay Hobbies 看于 {s.bayhobbies_seen ?? "—"} · 同款 = 同一货号，同车型 = 同一款车别的颜色 · 差 = 我们比 Bay Hobbies 贵多少
      </p>
      {s.unchecked_prices.length > 0 && (
        <Box title={`bot 找到、还没人核对的价格（${s.unchecked_prices.length}）`} tone="amber">
          <ul className="space-y-2 text-sm">
            {s.unchecked_prices.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3">
                <a href={o.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{o.name} · {o.source} {nz(o.total_nzd)}</a>
                <button onClick={() => run({ action: "price-status", id: o.id, status: "confirmed" })} className="px-2 py-0.5 rounded bg-emerald-600 text-white">是同款</button>
                <button onClick={() => { const why = prompt("哪里不对？（比如颜色不同、1:43）"); if (why !== null) run({ action: "price-status", id: o.id, status: "rejected", why }); }}
                  className="px-2 py-0.5 rounded border border-slate-300">不是</button>
              </li>
            ))}
          </ul>
        </Box>
      )}
      <Box title="我们 vs Bay Hobbies 和其他">
        <Table head={["车", "货号", "我们", "Bay Hobbies", "差", "进货价", "其他（Trade Me / 记下的）"]}>
          {s.products.map((p) => (
            <tr key={p.product} className="border-t border-slate-100 align-top">
              <td className="py-2 pr-3">{p.name}</td>
              <td className="pr-3 whitespace-nowrap">{p.ref ?? "—"} <span className="text-xs text-slate-400">{REF_LABELS[p.ref_status]}</span></td>
              <td className="pr-3">{nz(p.our_price)}</td>
              <td className="pr-3 whitespace-nowrap">{p.bayhobbies ? (
                <a href={p.bayhobbies.url ?? "#"} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline" title={p.bayhobbies.title}>
                  {nz(p.bayhobbies.price)} <span className="text-xs text-slate-500">{p.bayhobbies.match === "ref" ? "同款" : "同车型"}</span></a>) : "—"}</td>
              <td className={`pr-3 font-semibold ${(p.vs_bayhobbies_pct ?? 0) > 15 ? "text-red-600" : "text-emerald-600"}`}>
                {p.vs_bayhobbies_pct == null ? "—" : `${p.vs_bayhobbies_pct > 0 ? "+" : ""}${p.vs_bayhobbies_pct}%`}</td>
              <td className="pr-3 text-slate-500">{nz(p.goods_cost_nzd)}</td>
              <td className="text-xs">
                {p.others.map((o) => (
                  <a key={o.kind + o.id} href={o.url} target="_blank" rel="noreferrer" className="block text-blue-600 hover:underline">
                    {o.source} {nz(o.total_nzd)}{o.shipping_known ? "" : "（不含运费）"}{o.checked ? "" : "？"}</a>
                ))}
              </td>
            </tr>
          ))}
        </Table>
      </Box>
    </>
  );
}

function Refs({ s, run }: { s: MarketReport; run: Run }) {
  const confirm = (product: string, current: string | null) => {
    const ref = prompt("盒子标签上的货号（比如 182805）", current ?? "");
    if (ref) run({ action: "ref", product_id: product, ref: ref.trim(), status: "confirmed", sources: ["盒子标签（页面确认）"] });
  };
  return (
    <Box title={`货号：已确认 ${s.refs.confirmed} · 待核对 ${s.refs.candidate} · 未知 ${s.refs.unknown}（拍盒子侧面标签，对着填）`}>
      <Table head={["车", "网上找到的货号", "状态", "来源 / 备注", ""]}>
        {s.missing_refs.map((m) => (
          <tr key={m.product} className="border-t border-slate-100 align-top">
            <td className="py-2 pr-3">{m.name}</td>
            <td className="pr-3">{m.ref ?? "—"}</td>
            <td className={`pr-3 ${m.status === "unknown" ? "text-red-600" : "text-amber-600"}`}>{REF_LABELS[m.status]}</td>
            <td className="pr-3 text-xs text-slate-500">
              {m.sources.map((u) => (u.startsWith("http") ? <a key={u} href={u} target="_blank" rel="noreferrer" className="block text-blue-600 hover:underline">{new URL(u).hostname}</a> : <div key={u}>{u}</div>))}
              {m.note ? <div>{m.note}</div> : null}
            </td>
            <td><button onClick={() => confirm(m.product, m.ref)} className="px-2 py-0.5 rounded border border-slate-300 whitespace-nowrap">按盒子确认</button></td>
          </tr>
        ))}
      </Table>
    </Box>
  );
}

function Demand({ s }: { s: MarketReport }) {
  const d = s.demand;
  if (!d) return <p className="text-sm text-slate-500">还没有需求数据：服务器每 30 分钟推一次（dt market push）。</p>;
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

function Radar({ s, run }: { s: MarketReport; run: Run }) {
  return (
    <Box title={`我们还没卖的车（预估毛利 = 同车系我们现价中位数 − 进货价×汇率 − $${s.freight_est_nzd}，不是账本数字）`}>
      {s.radar.length === 0 ? <p className="text-sm text-slate-500">还没有候选：bot 每周五 09:00 找一次。</p> : (
        <Table head={["车", "货号", "车系", "海外", "同系我们卖", "进货价", "预估毛利", "状态", ""]}>
          {s.radar.map((c) => (
            <tr key={c.id} className={`border-t border-slate-100 ${c.status === "dropped" ? "text-slate-400" : ""}`}>
              <td className="py-2 pr-3"><a href={c.url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">{c.brand} {c.name}</a>
                {c.release ? <span className="text-xs text-slate-400"> · {c.release}</span> : null}
                {c.why ? <div className="text-xs text-slate-500">{c.why}</div> : null}</td>
              <td className="pr-3">{c.ref}</td>
              <td className="pr-3">{c.family_label}</td>
              <td className="pr-3">{nz(c.overseas_nzd)}{c.overseas_nzd != null && !c.shipping_known ? "（不含运费）" : ""}</td>
              <td className="pr-3">{nz(c.family_our_median_price)}</td>
              <td className="pr-3">
                <button onClick={() => { const cny = prompt("进货价（人民币）", c.supplier_cny ? String(c.supplier_cny) : ""); if (cny) run({ action: "radar-cost", id: c.id, cny: Number(cny) }); }}
                  className="text-blue-600 hover:underline">{c.supplier_cny == null ? "填" : `¥${c.supplier_cny}`}</button></td>
              <td className="pr-3">{c.margin_est_nzd == null ? "—" : nz(c.margin_est_nzd)}</td>
              <td className="pr-3">{RADAR_LABELS[c.status]}</td>
              <td className="whitespace-nowrap space-x-1">
                <button onClick={() => run({ action: "radar-status", id: c.id, status: "kept" })} className="px-2 py-0.5 rounded bg-emerald-600 text-white">要</button>
                <button onClick={() => { const why = prompt("为什么不要？（可不填）"); if (why !== null) run({ action: "radar-status", id: c.id, status: "dropped", why }); }}
                  className="px-2 py-0.5 rounded border border-slate-300">不要</button>
              </td>
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
        <thead><tr className="text-left text-slate-500">{head.map((h, i) => <th key={i} className="pb-2 pr-3 font-normal whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
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
