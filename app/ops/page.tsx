"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { RefreshCw } from "lucide-react";

// Numbers pushed by the driftae-ops server (`dt dashboard --push`): no customer names, no message text.
// What each metric means, its owner role, target and rule come from org/metrics.json in driftae-ops.
type Status = "ok" | "bad" | "info" | "unknown";
type Metric = {
  id: string; label: string; role: string; unit: string; direction: "lower" | "higher" | "info";
  value: number | null; target: number | null; status: Status; rule?: string; source: string;
  description: string; stale: boolean;
};
type Source = { ok: boolean; at: string | null; error: string | null; failed_at?: string };
type Snapshot = {
  built: string;
  version?: number;
  sources?: Record<string, Source>;
  metrics?: Metric[];
  team: { role: string; status: string; actions: number; checks: number; last_action: string | null }[];
  approvals: { kind: string; requested: string; approved: string | null; minutes: number | null }[];
  inbox: { conversation: string; asked: string; replied: string | null; status: "replied" | "waiting" | "dismissed"; minutes: number }[];
  ads_daily: { day: string; spend: number; impressions: number; link_clicks: number; conversations: number }[];
  ads: {
    ad: string; window: string; status: string; daily_budget: number; tag_theme?: string; tag_creative?: string;
    spend: number; impressions: number; ctr_pct: number | null; conversations: number; cost_per_conversation: number | null;
  }[];
  orders_monthly: { month: string; orders: number; revenue: number; gross_profit: number }[];
  orders_daily: { day: string; orders: number; revenue: number }[];
  trademe: { listing_id: number; title: string; price: number; views: number; watchers: number; end: string | null; synced: string }[];
  trademe_ended_early?: { listing_id: number; title: string; price: number; end: string; seen_gone: string }[];
};
type Point = { metric_id: string; day: string; value: number | null; status: string };

const ROLES: [string, string][] = [
  ["customer-service", "客服"], ["marketing", "营销"], ["sales", "销售（Trade Me）"], ["finance", "财务"], ["owner", "你（owner）"],
];
const SOURCE_NAMES: Record<string, string> = { meta: "Meta 广告 / Messenger", trademe: "Trade Me", orders: "订单系统", ledger: "agent 记录" };
const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string | null | undefined) => (iso ? iso.slice(5, 16).replace("T", " ") : "—");
const fmt = (m: Metric, v: number | null) =>
  v === null ? "—" : m.unit === "NZ$" ? money(v) : `${Number.isInteger(v) ? v : v.toFixed(1)}${m.unit === "%" ? "%" : " " + m.unit}`;

export default function OpsPage() {
  return (
    <AuthGate allow="any">
      <OpsContent />
    </AuthGate>
  );
}

function OpsContent() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Point[]>([]);
  const [hasDb, setHasDb] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/metrics", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "请重新登录" : "加载失败");
        const data = await res.json();
        setSnap(data.latest);
        setHistory(data.history ?? []);
        setHasDb(Boolean(data.database));
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading && !snap) return <Centered>加载中...</Centered>;
  if (error) return <Centered>{error}</Centered>;
  if (!snap) return <Centered>还没有数据：等服务器第一次推送（每 30 分钟一次）</Centered>;

  const metrics = snap.metrics ?? [];
  const bad = metrics.filter((m) => m.status === "bad");
  const rules = Array.from(new Set(metrics.filter((m) => m.rule).map((m) => m.rule!)));
  const series = (id: string) => history.filter((p) => p.metric_id === id);
  const teamStatus = (role: string) => snap.team.find((t) => t.role === role)?.status;
  const ageMin = (Date.now() - new Date(snap.built).getTime()) / 60000;
  const tm = [...snap.trademe].sort((a, b) => b.watchers - a.watchers || b.views - a.views);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-8">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Driftae 运营看板</h1>
            <p className={`text-sm mt-1 ${ageMin > 90 ? "text-amber-600" : "text-slate-500"}`}>
              数据更新于 {when(snap.built)}
              {ageMin > 90 && "（超过 90 分钟没更新，检查服务器推送）"}
              {!hasDb && " · 趋势需要连接数据库"}
            </p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <a href="/" className="text-slate-500 hover:text-slate-800">订单</a>
            <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 rounded-lg hover:bg-white">
              <RefreshCw className="w-4 h-4" /> 刷新
            </button>
          </div>
        </header>

        <p className="text-slate-700">
          {bad.length === 0
            ? "所有指标都在目标内。"
            : `${bad.length} 项没达标：${bad.map((m) => `${m.label} ${fmt(m, m.value)}（目标 ${m.direction === "lower" ? "≤" : "≥"} ${fmt(m, m.target)}）`).join("；")}。`}
        </p>

        {rules.length > 0 && (
          <Section title="规矩" note="Notion 里定的规矩，以及现在守住没有。">
            <div className="grid md:grid-cols-2 gap-3">
              {rules.map((rule) => {
                const ms = metrics.filter((m) => m.rule === rule);
                const broken = ms.filter((m) => m.status === "bad");
                return (
                  <div key={rule} className={`bg-white rounded-xl border p-4 ${broken.length ? "border-red-300" : "border-slate-200"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm text-slate-800">{rule}</p>
                      <Pill tone={broken.length ? "bad" : "ok"}>{broken.length ? "违反" : "守住"}</Pill>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">
                      {ms.map((m) => `${m.label} ${fmt(m, m.value)} / 目标 ${fmt(m, m.target)}`).join(" · ")}
                    </p>
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {snap.sources && (
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(snap.sources).map(([k, s]) => (
              <span key={k} title={s.error ?? ""}
                className={`px-2 py-1 rounded-full border ${s.ok ? "border-slate-200 text-slate-500" : "border-amber-300 text-amber-700 bg-amber-50"}`}>
                {SOURCE_NAMES[k] ?? k}：{s.ok ? `更新于 ${when(s.at)}` : `更新失败，数据停在 ${when(s.at)}`}
              </span>
            ))}
          </div>
        )}

        <Section title="各岗位" note="每个指标：现在的值、目标、30 天趋势。定义在 org/metrics.json。">
          <div className="grid lg:grid-cols-2 gap-4">
            {ROLES.map(([role, name]) => {
              const ms = metrics.filter((m) => m.role === role);
              if (!ms.length) return null;
              const st = teamStatus(role);
              return (
                <Card key={role} title={name}
                  note={role === "owner" ? "你的审批速度" : st === "planned" ? "这个岗位还没有独立的 agent，目前由营销 agent 代管" : "agent 在岗"}>
                  <div className="divide-y divide-slate-100">
                    {ms.map((m) => (
                      <div key={m.id} className="grid grid-cols-[1fr_auto_5.5rem] items-center gap-3 py-2" title={m.description}>
                        <div className="min-w-0">
                          <div className="text-sm text-slate-800">{m.label}{m.stale && <span className="text-amber-600 text-xs ml-1">（过期）</span>}</div>
                          <div className="text-xs text-slate-400">
                            {m.direction === "info" ? "参考值" : `目标 ${m.direction === "lower" ? "≤" : "≥"} ${fmt(m, m.target)}`}
                          </div>
                        </div>
                        <div className={`text-lg font-semibold tabular-nums text-right ${TONE_OF[m.status]}`}>{fmt(m, m.value)}</div>
                        <Spark points={series(m.id)} />
                      </div>
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        </Section>

        <Section title="私信（Messenger）" note="从客户第一条未回复的消息算到主页回复；自动回复不算。红色 = 超过 1 小时。已放弃 = 你在微信回了“放弃 码”，客人再发消息会重新提醒。">
          <Table head={["对话", "客户提问", "回复", "状态", "分钟", ""]}>
            {[...snap.inbox]
              .sort((a, b) => (a.status === b.status ? b.asked.localeCompare(a.asked) : a.status === "waiting" ? -1 : b.status === "waiting" ? 1 : 0))
              .map((r) => (
                <tr key={r.conversation + r.asked}>
                  <Td>{r.conversation}</Td>
                  <Td>{when(r.asked)}</Td>
                  <Td>{when(r.replied)}</Td>
                  <Td>
                    {r.status === "dismissed" ? <Pill>已放弃</Pill> : (
                      <Pill tone={r.status === "waiting" ? "bad" : r.minutes > 60 ? "warn" : "ok"}>{r.status === "waiting" ? "在等" : "已回复"}</Pill>
                    )}
                  </Td>
                  <Td num>{Math.round(r.minutes)}</Td>
                  <Td><Bar value={r.minutes} max={Math.max(...snap.inbox.map((x) => x.minutes), 1)} bad={r.minutes > 60} /></Td>
                </tr>
              ))}
          </Table>
        </Section>

        <Section title="从看到广告到下单" note="广告投放以来。订单是所有渠道的，未区分是否来自广告。">
          <Card title="转化漏斗">
            <Funnel steps={funnel(snap)} />
          </Card>
        </Section>

        <Section title="每条广告（投放以来）" note="标签说明这条广告在测什么。展示不到 1,000 次的先不下结论。">
          <Table head={["广告", "状态", "题材", "图片", "日预算", "花费", "展示", "点击率", "对话", "每对话"]}>
            {snap.ads.filter((a) => a.window === "lifetime").map((a) => (
              <tr key={a.ad}>
                <Td>{a.ad}</Td>
                <Td><Pill tone={a.status === "ACTIVE" ? "ok" : undefined}>{a.status === "ACTIVE" ? "在投" : a.status}</Pill></Td>
                <Td>{a.tag_theme ?? "—"}</Td>
                <Td>{a.tag_creative ?? "—"}</Td>
                <Td num>{money(a.daily_budget)}</Td>
                <Td num>{money(a.spend)}</Td>
                <Td num>{a.impressions.toLocaleString()}</Td>
                <Td num>{a.ctr_pct === null ? "—" : `${a.ctr_pct}%`}</Td>
                <Td num>{a.conversations}</Td>
                <Td num>{a.cost_per_conversation === null ? "—" : money(a.cost_per_conversation)}</Td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="Trade Me" note={`按关注数排序。有关注没成交 = 犹豫，考虑报价；浏览少 = 标题或图片要改。同步于 ${when(tm[0]?.synced)}`}>
          {snap.trademe_ended_early && snap.trademe_ended_early.length > 0 && (
            <Card title="提前下架（多为成交）" note="到期前离开 Trade Me：一口价被买走、接受了出价，或手动撤下。">
              <ul className="text-sm space-y-1">
                {[...snap.trademe_ended_early].reverse().slice(0, 10).map((e) => (
                  <li key={e.listing_id + e.seen_gone}>{when(e.seen_gone)} · ${e.price} · {e.title}</li>
                ))}
              </ul>
            </Card>
          )}
          <Table head={["商品", "价格", "浏览", "关注", "", "到期"]}>
            {tm.map((r) => (
              <tr key={r.listing_id}>
                <Td><a className="text-blue-700 hover:underline" href={`https://www.trademe.co.nz/a/listing/${r.listing_id}`} target="_blank" rel="noopener noreferrer">{r.title}</a></Td>
                <Td num>${r.price}</Td>
                <Td num>{r.views}</Td>
                <Td num><span className={r.watchers >= 3 ? "text-amber-600 font-medium" : ""}>{r.watchers}</span></Td>
                <Td><Bar value={r.views} max={Math.max(...tm.map((x) => x.views), 1)} bad={r.views < 10} /></Td>
                <Td>{when(r.end)}</Td>
              </tr>
            ))}
          </Table>
        </Section>

        <Section title="团队活动与审批">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="岗位" note="近 30 天。干活 = 起草、建广告、写知识库；巡检 = 查收件箱、查账户。">
              <Table head={["岗位", "状态", "干活", "巡检", "最近一次"]}>
                {snap.team.map((r) => (
                  <tr key={r.role}>
                    <Td>{ROLES.find(([k]) => k === r.role)?.[1] ?? r.role}</Td>
                    <Td><Pill tone={r.status === "active" ? "ok" : undefined}>{r.status === "active" ? "在岗" : "计划中"}</Pill></Td>
                    <Td num>{r.actions}</Td>
                    <Td num>{r.checks}</Td>
                    <Td>{when(r.last_action)}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
            <Card title="审批" note="agent 发微信审批码 → 批准之间的时间。">
              <Table head={["请求时间", "内容", "用时（分钟）"]}>
                {[...snap.approvals].reverse().map((r) => (
                  <tr key={r.requested + r.kind}>
                    <Td>{when(r.requested)}</Td>
                    <Td>{r.kind === "Messenger reply" ? "Messenger 回复" : r.kind}</Td>
                    <Td num>{r.minutes ?? "未批"}</Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </Section>

        <Section title="订单" note="每月合计，不含已取消。">
          <Table head={["月份", "订单", "销售额", "毛利"]}>
            {[...snap.orders_monthly].reverse().map((r) => (
              <tr key={r.month}>
                <Td>{r.month}</Td>
                <Td num>{r.orders}</Td>
                <Td num>{money(r.revenue)}</Td>
                <Td num>{money(r.gross_profit)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    </div>
  );
}

function funnel(snap: Snapshot): [string, number][] {
  const sum = (k: "impressions" | "link_clicks" | "conversations") => snap.ads_daily.reduce((t, r) => t + (r[k] || 0), 0);
  const first = snap.ads_daily.map((r) => r.day).sort()[0] ?? "9999";
  const orders = snap.orders_daily.filter((r) => r.day >= first).reduce((t, r) => t + r.orders, 0);
  return [["展示", sum("impressions")], ["链接点击", sum("link_clicks")], ["私信对话", sum("conversations")], ["订单", orders]];
}

const TONE_OF: Record<Status, string> = { ok: "text-emerald-600", bad: "text-red-600", info: "text-slate-900", unknown: "text-slate-400" };

function Spark({ points }: { points: Point[] }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) return <span className="text-xs text-slate-300 text-right">{vals.length ? "1 天" : "无历史"}</span>;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const xy = vals.map((v, i) => `${(i / (vals.length - 1)) * 84 + 2},${20 - ((v - min) / span) * 16}`).join(" ");
  const last = points[points.length - 1]?.status;
  return (
    <svg viewBox="0 0 88 24" className="w-[5.5rem] h-6" aria-hidden="true">
      <polyline points={xy} fill="none" stroke={last === "bad" ? "#dc2626" : "#64748b"} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen flex items-center justify-center p-4 text-slate-500">{children}</div>;
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        {note && <p className="text-xs text-slate-500 mt-0.5">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Card({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4 min-w-0">
      <h3 className="font-medium text-slate-800">{title}</h3>
      {note && <p className="text-xs text-slate-500 mb-3">{note}</p>}
      {children}
    </div>
  );
}

const TONE = { ok: "text-emerald-600", warn: "text-amber-600", bad: "text-red-600" };

function Pill({ tone, children }: { tone?: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border border-current ${tone ? TONE[tone] : "text-slate-500"}`}>
      {children}
    </span>
  );
}

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>{head.map((h, i) => <th key={i} className="px-3 py-2 text-left font-medium text-slate-600 whitespace-nowrap">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

function Td({ num, children }: { num?: boolean; children: React.ReactNode }) {
  return <td className={`px-3 py-2 ${num ? "text-right tabular-nums whitespace-nowrap" : ""}`}>{children}</td>;
}

function Bar({ value, max, bad }: { value: number; max: number; bad?: boolean }) {
  return (
    <div className="h-2 min-w-[4rem] rounded bg-slate-100">
      <div className={`h-2 rounded ${bad ? "bg-red-400" : "bg-slate-400"}`} style={{ width: `${Math.max(2, (100 * value) / max)}%` }} />
    </div>
  );
}

function Funnel({ steps }: { steps: [string, number][] }) {
  const max = Math.max(...steps.map(([, n]) => n), 1);
  return (
    <div className="space-y-2">
      {steps.map(([name, n], i) => (
        <div key={name}>
          {i > 0 && (
            <div className="text-xs text-slate-400 pl-20">
              ↓ {steps[i - 1][1] ? `${((100 * n) / steps[i - 1][1]).toFixed(1)}%` : "—"}
            </div>
          )}
          <div className="grid grid-cols-[5rem_1fr_4rem] items-center gap-2 text-sm">
            <span className="text-slate-600">{name}</span>
            <div className="h-5 rounded bg-slate-100">
              <div className="h-5 rounded bg-blue-500" style={{ width: `${Math.max(1, Math.sqrt(n / max) * 100)}%` }} />
            </div>
            <span className="text-right tabular-nums">{n.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
