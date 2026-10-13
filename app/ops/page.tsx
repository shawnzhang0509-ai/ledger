"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import { RefreshCw } from "lucide-react";

// Numbers pushed by the driftae-ops server (`dt dashboard --push`): no customer names, no message text.
type Metrics = {
  built: string;
  team: { role: string; status: string; actions: number; checks: number; last_action: string | null }[];
  approvals: { kind: string; requested: string; approved: string | null; minutes: number | null }[];
  inbox: { conversation: string; asked: string; replied: string | null; status: "replied" | "waiting"; minutes: number }[];
  ads_daily: { day: string; spend: number; impressions: number; link_clicks: number; conversations: number }[];
  ad_account: { spend_cap: number; amount_spent: number; active_adsets: number; daily_budget_active: number }[];
  ads: {
    ad: string; window: string; status: string; daily_budget: number; tag_theme?: string; tag_creative?: string;
    spend: number; impressions: number; ctr_pct: number | null; conversations: number; cost_per_conversation: number | null;
    enough_data: boolean;
  }[];
  orders_daily: { day: string; orders: number; revenue: number }[];
  trademe: { listing_id: number; title: string; price: number; views: number; watchers: number; end: string | null; synced: string }[];
};

const ROLE: Record<string, string> = {
  marketing: "营销", "customer-service": "客服", sales: "销售", operations: "运营", finance: "财务",
};
const money = (n: number) => `$${n.toFixed(2)}`;
const when = (iso: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : "—");
const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);

export default function OpsPage() {
  return (
    <AuthGate allow="any">
      <OpsContent />
    </AuthGate>
  );
}

function OpsContent() {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/metrics", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "请重新登录" : "加载失败");
        setM(await res.json());
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (loading && !m) return <Centered>加载中...</Centered>;
  if (error) return <Centered>{error}</Centered>;
  if (!m) return <Centered>还没有数据：等服务器第一次推送（每 30 分钟一次）</Centered>;

  const waiting = m.inbox.filter((r) => r.status === "waiting");
  const replied = m.inbox.filter((r) => r.status === "replied").map((r) => r.minutes).sort((a, b) => a - b);
  const median = replied.length ? replied[Math.floor((replied.length - 1) / 2)] : null;
  const within1h = replied.length ? Math.round((100 * replied.filter((x) => x <= 60).length) / replied.length) : null;
  const acct = m.ad_account[0];
  const spend = sum(m.ads_daily, (r) => r.spend);
  const impressions = sum(m.ads_daily, (r) => r.impressions);
  const clicks = sum(m.ads_daily, (r) => r.link_clicks);
  const convs = sum(m.ads_daily, (r) => r.conversations);
  const firstAdDay = m.ads_daily.map((r) => r.day).sort()[0] ?? "9999";
  const ordersSinceAds = sum(m.orders_daily.filter((r) => r.day >= firstAdDay), (r) => r.orders);
  const tm = [...m.trademe].sort((a, b) => b.watchers - a.watchers || b.views - a.views);
  const ending48 = tm.filter((r) => r.end && new Date(r.end).getTime() - Date.now() < 48 * 3600e3);
  const ageMin = (Date.now() - new Date(m.built).getTime()) / 60000;
  const months = Object.values(
    m.orders_daily.reduce<Record<string, { month: string; orders: number; revenue: number }>>((acc, r) => {
      const k = r.day.slice(0, 7);
      acc[k] = acc[k] ?? { month: k, orders: 0, revenue: 0 };
      acc[k].orders += r.orders;
      acc[k].revenue += r.revenue;
      return acc;
    }, {})
  ).sort((a, b) => b.month.localeCompare(a.month));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-7xl mx-auto p-4 lg:p-8 space-y-8">
        <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Driftae 运营看板</h1>
            <p className={`text-sm mt-1 ${ageMin > 90 ? "text-amber-600" : "text-slate-500"}`}>
              数据更新于 {when(m.built)}
              {ageMin > 90 && "（超过 90 分钟没更新，检查服务器推送）"}
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
          {waiting.length
            ? `${waiting.length} 位客户在等回复，最久 ${(Math.max(...waiting.map((r) => r.minutes)) / 60).toFixed(1)} 小时，先回他们。`
            : "没有客户在等回复。"}{" "}
          广告近 30 天花了 {money(spend)}，带来 {convs} 个私信对话
          {convs ? `（每个 ${money(spend / convs)}）` : ""}。
          {ending48.length > 0 && ` Trade Me 有 ${ending48.length} 件 48 小时内到期。`}
        </p>

        <Section title="现在">
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Tile label="等回复的客户" value={`${waiting.length} 位`} tone={waiting.length ? "bad" : "ok"}
              note={waiting.length ? `最久 ${(Math.max(...waiting.map((r) => r.minutes)) / 60).toFixed(1)} 小时` : "全部已回"} />
            <Tile label="私信回复时间（中位数）" value={median === null ? "—" : `${Math.round(median)} 分钟`}
              note={within1h === null ? "" : `${within1h}% 在 1 小时内，目标 100%`} tone={within1h !== null && within1h < 100 ? "warn" : undefined} />
            <Tile label="每个私信对话的广告成本" value={convs ? money(spend / convs) : "—"} note={`近 30 天 ${convs} 个对话`} />
            <Tile label="广告预算上限已用" value={acct ? `${money(acct.amount_spent)} / ${money(acct.spend_cap)}` : "—"}
              note={acct ? `${acct.active_adsets} 个广告组在投，每天合计 ${money(acct.daily_budget_active)}` : ""}
              tone={acct && acct.active_adsets > 1 ? "warn" : undefined} />
            <Tile label="Trade Me 48 小时内到期" value={`${ending48.length} 件`} tone={ending48.length ? "warn" : undefined}
              note={`在售 ${tm.length} 件，关注 ${sum(tm, (r) => r.watchers)}，浏览 ${sum(tm, (r) => r.views)}`} />
          </div>
        </Section>

        <Section title="私信（Messenger）" note="从客户第一条未回复的消息算到主页回复；自动回复不算。红色 = 超过 1 小时。">
          <Table head={["对话", "客户提问", "回复", "状态", "分钟", ""]}>
            {[...m.inbox]
              .sort((a, b) => (a.status === b.status ? b.asked.localeCompare(a.asked) : a.status === "waiting" ? -1 : 1))
              .map((r) => (
                <tr key={r.conversation + r.asked}>
                  <Td>{r.conversation}</Td>
                  <Td>{when(r.asked)}</Td>
                  <Td>{when(r.replied)}</Td>
                  <Td><Pill tone={r.status === "waiting" ? "bad" : r.minutes > 60 ? "warn" : "ok"}>{r.status === "waiting" ? "在等" : "已回复"}</Pill></Td>
                  <Td num>{Math.round(r.minutes)}</Td>
                  <Td><Bar value={r.minutes} max={Math.max(...m.inbox.map((x) => x.minutes), 1)} bad={r.minutes > 60} /></Td>
                </tr>
              ))}
          </Table>
        </Section>

        <Section title="广告与转化">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="从看到广告到下单" note="广告投放以来；订单是所有渠道的，未区分是否来自广告。">
              <Funnel steps={[["展示", impressions], ["链接点击", clicks], ["私信对话", convs], ["订单", ordersSinceAds]]} />
            </Card>
            <Card title="每天的广告花费" note="NZD">
              <div className="space-y-1.5">
                {m.ads_daily.map((d) => (
                  <div key={d.day} className="grid grid-cols-[4rem_1fr_auto] items-center gap-2 text-xs">
                    <span className="text-slate-500">{d.day.slice(5)}</span>
                    <Bar value={d.spend} max={Math.max(...m.ads_daily.map((x) => x.spend), 1)} />
                    <span className="tabular-nums">{money(d.spend)} · {d.link_clicks} 点击 · {d.conversations} 对话</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
          <Card title="每条广告（投放以来）" note="展示不到 1,000 次的先不下结论。">
            <Table head={["广告", "状态", "题材", "图片", "日预算", "花费", "展示", "点击率", "对话", "每对话"]}>
              {m.ads.filter((a) => a.window === "lifetime").map((a) => (
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
          </Card>
        </Section>

        <Section title="Trade Me" note={`按关注数排序。有关注没成交 = 犹豫，考虑报价；浏览少 = 标题或图片要改。同步于 ${when(tm[0]?.synced ?? null)}`}>
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

        <Section title="团队">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card title="岗位" note="近 30 天。干活 = 起草、建广告、写知识库；巡检 = 查收件箱、查账户。对外动作都要你在微信批准。">
              <Table head={["岗位", "状态", "干活", "巡检", "最近一次"]}>
                {m.team.map((r) => (
                  <tr key={r.role}>
                    <Td>{ROLE[r.role] ?? r.role}</Td>
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
                {[...m.approvals].reverse().map((r) => (
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
          <Table head={["月份", "订单", "销售额"]}>
            {months.map((r) => (
              <tr key={r.month}>
                <Td>{r.month}</Td>
                <Td num>{r.orders}</Td>
                <Td num>{money(r.revenue)}</Td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    </div>
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

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: keyof typeof TONE }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
      <div className="text-sm text-slate-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${tone ? TONE[tone] : "text-slate-900"}`}>{value}</div>
      {note && <div className="text-xs text-slate-500 mt-1">{note}</div>}
    </div>
  );
}

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
