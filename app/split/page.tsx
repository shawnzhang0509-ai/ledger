"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { KINDS, Kind, PEOPLE, Person, SplitReport } from "@/lib/split";
import { RefreshCw } from "lucide-react";

// Same numbers the bots send as a picture (`dt split card`). Entries are never edited: a wrong one is voided and stays visible.
const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const balanceText = (n: number) => (n > 0 ? `公司欠 ${money(n)}` : n < 0 ? `手上有公司的钱 ${money(-n)}` : "两清");
const blank = { who: "wife" as Person, kind: "advance" as Kind, to: "shawn" as Person, category: "进货", nzd: "", cny: "", what: "", day: "" };

export default function SplitPage() {
  return (
    <AuthGate allow="any">
      <SplitContent />
    </AuthGate>
  );
}

function SplitContent() {
  const [r, setR] = useState<SplitReport | null>(null);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const load = () => fetch("/api/split").then((x) => x.json()).then(setR).catch(() => setError("读取失败"));
  useEffect(() => { load(); }, []);

  const post = async (body: object) => {
    setError(null);
    const res = await fetch("/api/split", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json();
    if (!res.ok) setError(d.error || "没记上");
    return res.ok;
  };
  const add = async () => {
    const ok = await post({ action: "add", ...form, to: form.kind === "transfer" ? form.to : null, category: form.kind === "advance" ? form.category : null, day: form.day || null });
    if (ok) { setForm(blank); load(); }
  };
  const input = "border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white";

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-5xl mx-auto p-4 lg:p-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">分账</h1>
            <p className="text-slate-500 text-sm mt-1">谁出了多少 · 谁垫了多少 · 公司的钱在谁手上（先不分利润）</p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <a href="/books" className="text-slate-500 hover:text-slate-800">账本</a>
            <button onClick={load} className="flex items-center gap-1 text-slate-500 hover:text-slate-800"><RefreshCw className="w-4 h-4" />刷新</button>
          </div>
        </div>
        {error && <p className="text-red-700 text-sm">{error}</p>}
        {r && (
          <>
            <div className="grid sm:grid-cols-3 gap-4">
              {r.people.map((p) => (
                <div key={p.who} className="bg-white rounded-xl border border-slate-200 p-4 space-y-1 text-sm">
                  <div className="text-lg font-bold text-slate-900">{p.name}</div>
                  <div className={`font-semibold ${p.balance > 0 ? "text-amber-700" : "text-slate-700"}`}>{balanceText(p.balance)}</div>
                  <div className="text-slate-500">出资 {money(p.capital)}（不算在上面）</div>
                  <div className="text-slate-500">垫付 {money(p.advance)}</div>
                  <div className="text-slate-500">转出 {money(p.sent)} · 收到 {money(p.received)}</div>
                  {p.sales > 0 && <div className="text-slate-500">Trade Me 收款 {money(p.sales)}</div>}
                </div>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-700">
              账本里的成本 {money(r.costs_in_books)} · 已写明谁付 {money(r.costs_named)} · <span className={r.costs_unnamed ? "text-amber-700 font-semibold" : ""}>还差 {money(r.costs_unnamed)}</span>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-wrap gap-2 items-center">
              <select className={input} value={form.who} onChange={(e) => setForm({ ...form, who: e.target.value as Person })}>
                {Object.entries(PEOPLE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className={input} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })}>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              {form.kind === "transfer" && (
                <select className={input} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value as Person })}>
                  {Object.entries(PEOPLE).map(([k, v]) => <option key={k} value={k}>给 {v}</option>)}
                </select>
              )}
              {form.kind === "advance" && (
                <select className={input} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {["进货", "运费", "快递", "广告", "其他"].map((c) => <option key={c}>{c}</option>)}
                </select>
              )}
              <input className={`${input} w-28`} placeholder="纽币 $" inputMode="decimal" value={form.nzd} onChange={(e) => setForm({ ...form, nzd: e.target.value })} />
              <input className={`${input} w-28`} placeholder="或人民币 ¥" inputMode="decimal" value={form.cny} onChange={(e) => setForm({ ...form, cny: e.target.value })} />
              <input className={`${input} flex-1 min-w-40`} placeholder="说明" value={form.what} onChange={(e) => setForm({ ...form, what: e.target.value })} />
              <input className={input} type="date" value={form.day} onChange={(e) => setForm({ ...form, day: e.target.value })} />
              <button onClick={add} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm">记一笔</button>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
              {!r.entries.length && <p className="p-4 text-slate-500">还没有记录</p>}
              {r.entries.map((e) => (
                <div key={e.id} className={`flex flex-wrap items-center gap-3 p-3 ${e.voided ? "opacity-50 line-through" : ""}`}>
                  <span className="text-slate-500 w-24">{e.day}</span>
                  <span className="font-medium">{PEOPLE[e.who]} {KINDS[e.kind]}{e.to ? ` 给 ${PEOPLE[e.to]}` : ""}{e.category ? ` · ${e.category}` : ""}</span>
                  <span className="flex-1 text-slate-500 min-w-40">{e.what}{e.cny ? ` · ¥${e.cny}（汇率 ${e.rate ?? "—"}）` : ""}</span>
                  <span className="font-semibold">{money(e.nzd)}</span>
                  {!e.voided && <button onClick={async () => { if (window.confirm("作废这一笔？记录会留着。") && await post({ action: "void", id: e.id })) load(); }} className="text-xs text-slate-400 hover:text-red-700">作废</button>}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
