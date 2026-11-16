"use client";

import { useEffect, useMemo, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { Check, Loader2 } from "lucide-react";

type Product = { id: string; name: string; brand: string; image: string };
type Price = { product_id: string; price: number | null; list_on_trademe: boolean; title: string | null; updated_at: string };
type Status = { product_id: string; state: string; listing_id: string | null; tm_price: number | null; message: string | null; title: string | null; at: string };
type Draft = { price: string; list: boolean; title: string };

const STATE: Record<string, [string, string]> = {
  listed: ["在 Trade Me 上", "text-emerald-700"],
  listed_new: ["刚上架", "text-emerald-700"],
  price_updated: ["已改价", "text-emerald-700"],
  queued: ["排队中", "text-amber-700"],
  not_listed: ["未勾选上架", "text-slate-500"],
  no_price: ["没填价格", "text-slate-400"],
  error: ["出错", "text-red-700"],
};

export default function CatalogPage() {
  return (
    <AuthGate allow="any">
      <Catalog />
    </AuthGate>
  );
}

const COST_RANGES = ["100-150", "150-200", "200-250", "250-300", "300-350", "350-400", "400-450", "450-500"];

function Catalog() {
  const [products, setProducts] = useState<Product[]>([]);
  const [prices, setPrices] = useState<Record<string, Price>>({});
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [costs, setCosts] = useState<Record<string, number | null>>({});
  const [costMax, setCostMax] = useState<Record<string, number | null>>({});
  const [skus, setSkus] = useState<Record<string, { sku: string; merged_into: string | null }>>({});
  const [byCost, setByCost] = useState(false);
  const [missing, setMissing] = useState(false); // owner 2026-11-15: a link (/catalog?missing=1) to only the cars with no 进货价
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [canEdit, setCanEdit] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = async () => {
    const [p, c, a] = await Promise.all([
      fetch("/api/products").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/catalog").then((r) => (r.ok ? r.json() : { prices: [], status: [] })),
      fetch("/api/auth").then((r) => r.json()),
    ]);
    setProducts(p);
    setPrices(Object.fromEntries(c.prices.map((x: Price) => [x.product_id, x])));
    setStatus(Object.fromEntries(c.status.map((x: Status) => [x.product_id, x])));
    setCosts(Object.fromEntries((c.costs ?? []).map((x: { product_id: string; cost_cny: number | null }) => [x.product_id, x.cost_cny])));
    setCostMax(Object.fromEntries((c.costs ?? []).map((x: { product_id: string; cost_cny_max: number | null }) => [x.product_id, x.cost_cny_max])));
    setSkus(Object.fromEntries((c.numbers ?? []).map((x: { product_id: string; sku: string; merged_into: string | null }) => [x.product_id, x])));
    setCanEdit(Boolean(a.role));
    setDrafts(Object.fromEntries(p.map((x: Product) => {
      const pr = c.prices.find((y: Price) => y.product_id === x.id);
      return [x.id, { price: pr?.price?.toString() ?? "", list: pr?.list_on_trademe ?? false, title: pr?.title ?? "" }];
    })));
  };
  useEffect(() => {
    load();
    if (new URLSearchParams(window.location.search).get("missing")) setMissing(true);
  }, []);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = products.filter((p) => (!s || `${skus[p.id]?.sku ?? ""} ${p.name} ${p.brand} ${p.id}`.toLowerCase().includes(s))
      && (!missing || costs[p.id] == null));
    // owner 2026-11-05: sort by the entered cost (dearest first); cars without a cost go last
    return byCost ? [...list].sort((a, b) => (costs[b.id] ?? -1) - (costs[a.id] ?? -1)) : list;
  }, [products, q, byCost, missing, costs, skus]);

  async function save(id: string) {
    const d = drafts[id];
    setSaving(id);
    setError(null);
    const res = await fetch("/api/catalog", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product_id: id, price: d.price === "" ? null : Number(d.price), list_on_trademe: d.list, title: d.title }),
    });
    setSaving(null);
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error ?? "保存失败");
      return;
    }
    setSaved(id);
    setTimeout(() => setSaved(null), 2000);
    load();
  }

  // owner 2026-11-16: pick a range from a list; 「其它」 still lets you type one
  async function editCost(id: string, picked: string) {
    const v = picked === "other" ? prompt("进货价（人民币，比如 520 或 500-600）", costText(id) ?? "") : picked;
    if (v === null) return;
    const res = await fetch("/api/market/bot", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cost", product_id: id, cny: v.trim() }),
    });
    if (!res.ok) { setError((await res.json().catch(() => ({}))).error ?? "保存失败"); return; }
    load();
  }

  // owner 2026-11-16: a range is fine for an ordinary car (exact cost goes on the order when it sells)
  const costText = (id: string) => costs[id] == null ? null : costMax[id] != null ? `${costs[id]}-${costMax[id]}` : String(costs[id]);
  const set = (id: string, patch: Partial<Draft>) => setDrafts((all) => ({ ...all, [id]: { ...all[id], ...patch } }));
  const changed = (id: string) => {
    const d = drafts[id], p = prices[id];
    return d && (d.price !== (p?.price?.toString() ?? "") || d.list !== (p?.list_on_trademe ?? false) || d.title !== (p?.title ?? ""));
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 lg:p-8 space-y-4">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">商品与价格</h1>
            <p className="text-sm text-slate-500 mt-1">
              {canEdit
                ? "填一口价并勾选“上 Trade Me”= 批准上架；已在 Trade Me 上的，改这里的价格 = 批准改价。服务器每 30 分钟同步一次，每次最多上新 5 件。"
                : "登录后可以改价格。"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/ops" className="text-slate-500 hover:text-slate-800">运营看板</a>
            <a href="/photos" className="text-slate-500 hover:text-slate-800">上传照片</a>
          </div>
        </header>
        <div className="flex flex-wrap items-center gap-3">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜车型或商品号（D-0012）"
            className="w-full sm:w-80 px-3 py-2 border border-slate-300 rounded-lg text-sm" />
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={byCost} onChange={(e) => setByCost(e.target.checked)} /> 按进货价排（贵的在前）
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-600">
            <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} /> 只看没填进货价的
            {` (${products.filter((p) => costs[p.id] == null).length})`}
          </label>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
          {rows.map((p) => {
            const st = status[p.id], d = drafts[p.id] ?? { price: "", list: false, title: "" };
            const [label, tone] = STATE[st?.state ?? ""] ?? ["未同步", "text-slate-400"];
            return (
              <div key={p.id} className="p-3 grid gap-3 md:grid-cols-[4rem_1fr_15rem] items-start">
                {p.image ? <img src={p.image} alt="" className="w-16 h-12 object-cover rounded" /> : <div />}
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-medium text-slate-800">
                    {skus[p.id] && <span className="mr-2 font-mono text-slate-500">{skus[p.id].sku}</span>}
                    {p.name}
                    {skus[p.id]?.merged_into && <span className="ml-2 text-xs text-amber-700">和 {skus[p.id].merged_into} 是同一台</span>}
                  </div>
                  <div className="text-xs">
                    <span className={tone}>{label}</span>
                    {st?.listing_id && (
                      <> · <a className="text-blue-700 hover:underline" target="_blank" rel="noopener noreferrer"
                        href={`https://www.trademe.co.nz/a/listing/${st.listing_id}`}>Trade Me{st.tm_price ? ` $${st.tm_price}` : ""}</a></>
                    )}
                    {st?.message && st.state !== "listed" && <span className="text-slate-500"> · {st.message}</span>}
                    <> · 进货价 {canEdit ? (
                      <select value={costText(p.id) ?? ""} onChange={(e) => editCost(p.id, e.target.value)}
                        className="text-blue-700 bg-transparent border border-slate-200 rounded px-1 py-0.5">
                        <option value="">{costs[p.id] != null ? "清除" : "选区间"}</option>
                        {costText(p.id) && !COST_RANGES.includes(costText(p.id)!) && <option value={costText(p.id)!}>¥{costText(p.id)}</option>}
                        {COST_RANGES.map((r) => <option key={r} value={r}>¥{r.replace("-", "–")}</option>)}
                        <option value="other">其它（自己填）</option>
                      </select>
                    ) : (costs[p.id] != null ? `¥${costText(p.id)}` : "—")}</>
                  </div>
                  <input value={d.title} disabled={!canEdit} onChange={(e) => set(p.id, { title: e.target.value })} maxLength={80}
                    placeholder={st?.title ? `Trade Me 标题：${st.title}` : "Trade Me 标题（留空自动生成）"}
                    className="w-full px-2 py-1 border border-slate-200 rounded text-xs disabled:bg-slate-50" />
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                    <input value={d.price} disabled={!canEdit} inputMode="decimal" onChange={(e) => set(p.id, { price: e.target.value.replace(/[^\d.]/g, "") })}
                      placeholder="一口价" className="w-24 pl-5 pr-2 py-1.5 border border-slate-300 rounded text-sm disabled:bg-slate-50" />
                  </div>
                  <label className="flex items-center gap-1 text-xs text-slate-600 whitespace-nowrap">
                    <input type="checkbox" checked={d.list} disabled={!canEdit} onChange={(e) => set(p.id, { list: e.target.checked })} />
                    上 Trade Me
                  </label>
                  {canEdit && (
                    <button onClick={() => save(p.id)} disabled={!changed(p.id) || saving === p.id}
                      className="px-2.5 py-1.5 text-xs rounded bg-slate-800 text-white disabled:bg-slate-200 disabled:text-slate-400">
                      {saving === p.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved === p.id ? <Check className="w-3.5 h-3.5" /> : "保存"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
