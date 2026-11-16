"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import type { BookLine, BooksReport } from "@/lib/books";
import { photoFor } from "@/lib/product-photo";

// 首页 (owner 2026-11-16: 「一眼看到全局」, dyslexia): big numbers, car photos and colour bars, few words.
// Same numbers as 账本 (/api/orders/report), 商品与价格 (/api/catalog) and 运营看板 (/api/metrics); nothing is computed elsewhere.
type Product = { id: string; name: string; image: string };
type Status = { product_id: string; state: string; listing_id: string | null; tm_price: number | null };
type TmRow = { listing_id: number; watchers: number };

const money = (n: number) => `$${Math.round(n).toLocaleString("en-NZ")}`;
const BAR = [
  { key: "purchase", label: "进货", color: "#94a3b8" },
  { key: "ship", label: "运费", color: "#60a5fa" },
  { key: "fee", label: "手续费", color: "#fbbf24" },
  { key: "gp", label: "赚", color: "#10b981" },
] as const;
const LINKS = [
  ["/orders", "订单"], ["/books", "账本"], ["/catalog", "商品与价格"], ["/ops", "运营看板"],
  ["/split", "分账"], ["/stock", "库存"], ["/market", "比价"], ["/photos", "上传照片"], ["/team", "bot 能做什么"],
];

export default function Home() {
  return (
    <AuthGate>
      <HomeContent />
    </AuthGate>
  );
}

function HomeContent() {
  const [books, setBooks] = useState<BooksReport | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [status, setStatus] = useState<Status[]>([]);
  const [tm, setTm] = useState<TmRow[]>([]);

  useEffect(() => {
    fetch("/api/orders/report").then((r) => (r.ok ? r.json() : null)).then(setBooks).catch(() => {});
    fetch("/api/products").then((r) => (r.ok ? r.json() : [])).then(setProducts).catch(() => {});
    fetch("/api/catalog").then((r) => (r.ok ? r.json() : { status: [] })).then((c) => setStatus(c.status ?? [])).catch(() => {});
    fetch("/api/metrics").then((r) => (r.ok ? r.json() : null)).then((m) => setTm(m?.latest?.trademe ?? [])).catch(() => {});
  }, []);

  const byId = Object.fromEntries(products.map((p) => [p.id, p]));

  const month = new Date().toLocaleDateString("en-CA", { timeZone: "Pacific/Auckland" }).slice(0, 7);
  const lines = (books?.lines ?? []).filter((l) => l.status !== "Cancelled" && l.price > 0);
  const thisMonth = lines.filter((l) => l.dateSold.startsWith(month));
  const listed = status.filter((s) => s.state === "listed");
  const noPrice = status.filter((s) => s.state === "no_price" && byId[s.product_id]);
  const watchers = Object.fromEntries(tm.map((t) => [String(t.listing_id), t.watchers ?? 0]));
  const wall = [...listed].sort((a, b) => (watchers[b.listing_id ?? ""] ?? 0) - (watchers[a.listing_id ?? ""] ?? 0));

  const perMonth: Record<string, number> = {};
  for (const l of lines) perMonth[l.dateSold.slice(0, 7)] = (perMonth[l.dateSold.slice(0, 7)] ?? 0) + l.gp;
  const months = Object.keys(perMonth).sort().slice(-5);
  const top = Math.max(1, ...months.map((k) => perMonth[k]));

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <div className="max-w-md mx-auto p-4 space-y-6">
        <h1 className="text-2xl font-extrabold">Driftae · {Number(month.slice(5))}月</h1>

        <div className="grid grid-cols-3 gap-2">
          <Kpi href="/books" n={books ? String(thisMonth.length) : "…"} label="卖了几台" />
          <Kpi href="/books" n={books ? money(thisMonth.reduce((t, l) => t + l.gp, 0)) : "…"} label="赚了" green />
          <Kpi href="/ops" n={status.length ? String(listed.length) : "…"} label="在卖" />
        </div>

        {noPrice.length > 0 && (
          <Section title="要你们做">
            <a href="/catalog" className="block bg-red-100 rounded-2xl p-3">
              <div className="text-lg font-bold text-red-700">{noPrice.length} 台车没定价 →</div>
              <div className="text-sm text-red-900 mb-2">网站有，Trade Me 没挂</div>
              <div className="flex gap-1.5 overflow-hidden">
                {noPrice.slice(0, 6).map((s) => <Photo key={s.product_id} src={byId[s.product_id]?.image} className="w-12 h-12 rounded-lg shrink-0" />)}
              </div>
            </a>
          </Section>
        )}

        <Section title="最近卖出">
          <div className="flex gap-3 text-xs text-slate-600 -mt-1 mb-2">
            {BAR.map((b) => <span key={b.key} className="flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: b.color }} />{b.label}</span>)}
          </div>
          <div className="space-y-2">
            {lines.slice(0, 4).map((l) => <Sold key={l.orderId} l={l} photo={photoFor(products, l.model)} />)}
            {!books && <p className="text-slate-500">读取中…</p>}
          </div>
        </Section>

        <Section title="在卖 · 🔥 = 很多人关注">
          <div className="grid grid-cols-3 gap-1.5">
            {wall.slice(0, 12).map((s) => {
              const w = watchers[s.listing_id ?? ""] ?? 0;
              return (
                <a key={s.product_id} href={`https://www.trademe.co.nz/a/listing/${s.listing_id}`} target="_blank" rel="noopener noreferrer" className="relative block">
                  <Photo src={byId[s.product_id]?.image} className="w-full aspect-square rounded-xl" />
                  {s.tm_price != null && <span className="absolute left-1 bottom-1 bg-slate-900/80 text-white text-xs px-1.5 rounded">${s.tm_price}</span>}
                  {w >= 3 && <span className="absolute right-1 top-1 bg-white text-xs px-1 rounded">🔥 {w}</span>}
                </a>
              );
            })}
          </div>
          {wall.length > 12 && <a href="/ops" className="block text-center text-sm text-blue-700 mt-2">全部 {wall.length} 台 →</a>}
        </Section>

        {months.length > 0 && (
          <Section title="每月赚多少">
            <div className="flex items-end gap-2 bg-white rounded-2xl p-3 h-40">
              {months.map((k) => (
                <div key={k} className="flex-1 text-center">
                  <div className="text-xs text-slate-500">{money(perMonth[k])}</div>
                  <div className="bg-emerald-500 rounded-t-md" style={{ height: `${Math.max(2, (perMonth[k] / top) * 90)}px` }} />
                  <div className="text-sm mt-1">{Number(k.slice(5))}月</div>
                </div>
              ))}
            </div>
          </Section>
        )}

        <div className="grid grid-cols-3 gap-2 pb-6">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className="bg-white rounded-xl py-3 text-center text-sm font-medium text-slate-700">{label}</a>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2 className="text-xl font-bold mb-2.5">{title}</h2>{children}</section>;
}

function Kpi({ n, label, green, href }: { n: string; label: string; green?: boolean; href: string }) {
  return (
    <a href={href} className="bg-white rounded-2xl py-3 text-center">
      <div className={`text-2xl font-bold ${green ? "text-emerald-600" : ""}`}>{n}</div>
      <div className="text-sm text-slate-500">{label}</div>
    </a>
  );
}

function Photo({ src, className }: { src?: string; className: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" loading="lazy" className={`object-cover bg-slate-200 ${className}`} /> : <div className={`bg-slate-200 ${className}`} />;
}

function Sold({ l, photo }: { l: BookLine; photo: string }) {
  const parts = { purchase: l.purchase, ship: l.air + l.courier, fee: l.fee, gp: Math.max(l.gp, 0) };
  const total = Object.values(parts).reduce((t, v) => t + v, 0) || 1;
  return (
    <a href="/books" className="flex gap-2.5 bg-white rounded-2xl p-2">
      <Photo src={photo} className="w-24 h-[72px] rounded-lg shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{l.model}</div>
        <div className="flex justify-between my-1">
          <span>卖 {money(l.price)}</span>
          <b className={l.complete ? "text-emerald-600" : "text-slate-400"}>{l.complete ? `赚 ${money(l.gp)}` : "缺数"}</b>
        </div>
        <div className="flex h-2.5 rounded-full overflow-hidden">
          {BAR.map((b) => <i key={b.key} style={{ width: `${(parts[b.key] / total) * 100}%`, background: b.color }} />)}
        </div>
      </div>
    </a>
  );
}
