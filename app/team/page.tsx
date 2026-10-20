"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { RefreshCw } from "lucide-react";

// What the team's WeChat bots do, pushed by the driftae-ops server (`dt dashboard --push`) from org/capabilities.json,
// the bots' live scheduled jobs and dt's grants. The same for all three: every scheduled job reaches everyone.
type Live = { schedule: string | null; enabled: boolean; next_run: string | null; last_run: string | null; last_status: string | null; team: boolean };
type Item = {
  category: string; name: string; what: string; when?: string; say?: string; code?: string; job?: string | null;
  dt?: string[]; live?: Live[]; unknown_dt?: string[];
};
type Caps = {
  categories: { id: string; label: string; blurb: string }[];
  items: Item[];
  jobs_exported: string | null;
  uncatalogued_jobs: { name: string; schedule: string; profile: string }[];
  uncatalogued_dt: string[];
};

const when = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("zh-CN", { timeZone: "Pacific/Auckland", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—";
const TONE: Record<string, string> = {
  schedule_image: "border-l-sky-500", schedule_text: "border-l-indigo-400", ask: "border-l-emerald-500", do: "border-l-amber-500", cannot: "border-l-slate-300",
};

export default function TeamPage() {
  return (
    <AuthGate allow="any">
      <TeamContent />
    </AuthGate>
  );
}

function TeamContent() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [built, setBuilt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/metrics", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "请重新登录" : "加载失败");
        const data = await res.json();
        setCaps(data.latest?.capabilities ?? null);
        setBuilt(data.latest?.built ?? null);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading && !caps) return <Centered>加载中...</Centered>;
  if (error) return <Centered>{error}</Centered>;
  if (!caps) return <Centered>还没有数据：等服务器下一次推送（每 30 分钟一次）</Centered>;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-6xl mx-auto p-4 lg:p-8 space-y-8">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">团队的 bot 能做什么</h1>
            <p className="text-sm mt-1 text-slate-500">
              道长、太太、Stella 三个人的 bot 能力一样，定时消息三个人收到的也一样。更新于 {when(built)}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/ops" className="text-slate-500 hover:text-slate-800">运营看板</a>
            <a href="/catalog" className="text-slate-500 hover:text-slate-800">商品与价格</a>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-white">
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
          </div>
        </header>

        <section className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5">
          <h2 className="font-semibold text-slate-900">批准码怎么用</h2>
          <ol className="mt-3 grid sm:grid-cols-3 gap-3 text-sm text-slate-700">
            <li className="rounded-lg bg-slate-50 p-3"><b className="text-slate-900">1.</b> bot 发一张确认卡：要发出去的原文，和一个 6 位码。</li>
            <li className="rounded-lg bg-slate-50 p-3"><b className="text-slate-900">2.</b> 同意就回「词 + 码」，比如「发帖 123456」。不同意不用理。</li>
            <li className="rounded-lg bg-slate-50 p-3"><b className="text-slate-900">3.</b> 执行完 bot 把结果发回来。码 24 小时有效，只对这一条有效。</li>
          </ol>
          <p className="text-xs text-slate-500 mt-3">
            定时任务开的码三个人都收到，谁先回都行；你自己让 bot 办的事，码只发给你。
            微信规定 bot 只能给最近跟它说过话的人发消息：太久没跟 bot 说话，定时消息会等你下次发消息时补发。
          </p>
        </section>

        {caps.categories.map((c) => {
          const items = caps.items.filter((i) => i.category === c.id);
          if (!items.length) return null;
          return (
            <section key={c.id}>
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2 className="text-lg font-semibold text-slate-900">{c.label}</h2>
                <p className="text-sm text-slate-500">{c.blurb}</p>
              </div>
              <div className="mt-3 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {items.map((i) => <Card key={i.name} item={i} tone={TONE[c.id] ?? "border-l-slate-300"} />)}
              </div>
            </section>
          );
        })}

        {(caps.uncatalogued_jobs.length > 0 || caps.uncatalogued_dt.length > 0) && (
          <section className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-900">
            <h2 className="font-semibold">还没写进这张表的（找道长补说明）</h2>
            {caps.uncatalogued_jobs.map((j) => <p key={j.name} className="mt-1">定时任务：{j.name}（{j.schedule}，{j.profile}）</p>)}
            {caps.uncatalogued_dt.length > 0 && <p className="mt-1">工具命令：{caps.uncatalogued_dt.join("、")}</p>}
          </section>
        )}
        <p className="text-xs text-slate-400">定时任务的状态来自服务器（{when(caps.jobs_exported)} 导出）；说明在 driftae-ops 的 org/capabilities.json。</p>
      </div>
    </div>
  );
}

function Card({ item, tone }: { item: Item; tone: string }) {
  const live = item.live ?? [];
  const missing = item.job && live.length === 0;
  const notTeam = live.some((l) => !l.team);
  const failed = live.some((l) => l.last_status && l.last_status !== "ok");
  return (
    <div className={`bg-white rounded-xl border border-slate-200 border-l-4 ${tone} p-4 flex flex-col gap-2`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-slate-900">{item.name}</h3>
        {item.code && <span className="shrink-0 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">回「{item.code} 码」</span>}
      </div>
      {item.when && <p className="text-xs font-medium text-slate-500">{item.when}</p>}
      <p className="text-sm text-slate-700">{item.what}</p>
      {item.say && <p className="text-sm text-slate-900 bg-slate-50 rounded-lg px-3 py-2">跟 bot 说：「{item.say}」</p>}
      {item.job && (
        <p className={`text-xs ${missing || notTeam || failed ? "text-red-600" : "text-slate-500"}`}>
          {missing
            ? "服务器上没找到这个任务"
            : live.map((l) => `下次 ${when(l.next_run)} · 上次 ${l.last_status === "ok" ? "成功" : l.last_status ?? "没跑过"}${l.team ? " · 三人同发" : " · 只发给一个人"}${l.enabled ? "" : " · 已暂停"}`).join("；")}
        </p>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center text-slate-500">{children}</div>;
}
