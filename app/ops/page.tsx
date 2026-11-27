"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/auth-gate";
import {
  Bot, Camera, CheckCircle2, Clock, Eye, Heart, Home, Info, Megaphone, MessageCircle, Receipt, RefreshCw, Tag,
  Trophy, UserCheck, Wallet, XCircle, type LucideIcon,
} from "lucide-react";
import { type AdRace, raceLabel, raceState } from "@/lib/ad-race";

// Numbers pushed by the driftae-ops server (`dt dashboard --push`): no customer names, no message text.
// What each metric means, its owner role, target and rule come from org/metrics.json in driftae-ops.
// Read at a glance (owner 2026-11-27, dyslexia: "全是文字"): big numbers, colour and icons first; every
// explanation sits behind ⓘ. Ink and orange, like brain.
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
  ad_race?: AdRace;
  orders_monthly: { month: string; orders: number; revenue: number; gross_profit: number }[];
  orders_daily: { day: string; orders: number; revenue: number }[];
  trademe: { listing_id: number; title: string; price: number; views: number; watchers: number; end: string | null; synced: string }[];
  trademe_ended_early?: { listing_id: number; title: string; price: number; end: string; seen_gone: string }[];
  trademe_daily?: {
    days: string[];
    rows: { product_ids: string[]; title: string; listing_id: number; price: number; live: boolean; relisted: string[];
      views: (number | null)[]; watchers: (number | null)[] }[];
  };
};
type Point = { metric_id: string; day: string; value: number | null; status: string };

const ROLES: [string, string, LucideIcon][] = [
  ["customer-service", "客服", MessageCircle], ["marketing", "营销", Megaphone], ["sales", "Trade Me", Tag],
  ["finance", "财务", Wallet], ["owner", "你", UserCheck],
];
const roleIcon = (role: string) => ROLES.find(([k]) => k === role)?.[2] ?? Bot;
const SOURCE_NAMES: Record<string, string> = { meta: "Meta", trademe: "Trade Me", orders: "订单", ledger: "记录", bots: "bot" };
const money = (n: number) => (Math.abs(n) >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(n % 1 ? 2 : 0)}`);
const when = (iso: string | null | undefined) => (iso ? iso.slice(5, 16).replace("T", " ") : "—");
const fmt = (m: Metric, v: number | null) =>
  v === null ? "—" : m.unit === "NZ$" ? money(v) : `${Number.isInteger(v) ? v : v.toFixed(1)}${m.unit === "%" ? "%" : " " + m.unit}`;
const target = (m: Metric) => (m.direction === "info" ? "参考" : `${m.direction === "lower" ? "≤" : "≥"} ${fmt(m, m.target)}`);

const C = {
  page: "bg-[#f5f3ee] text-[#16161a]",
  card: "bg-white rounded-[24px]",
  soft: "text-[#5e5b55]",
  accent: "text-[#c2410c]",
  good: "text-[#15803d]",
  bad: "text-[#c2410c]",
};

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

  if (loading && !snap) return <Centered>加载中…</Centered>;
  if (error) return <Centered>{error}</Centered>;
  if (!snap) return <Centered>还没有数据：等服务器第一次推送（每 30 分钟一次）</Centered>;

  const metrics = snap.metrics ?? [];
  const bad = metrics.filter((m) => m.status === "bad");
  const rules = Array.from(new Set(metrics.filter((m) => m.rule).map((m) => m.rule!)));
  const series = (id: string) => history.filter((p) => p.metric_id === id);
  const teamStatus = (role: string) => snap.team.find((t) => t.role === role)?.status;
  const ageMin = (Date.now() - new Date(snap.built).getTime()) / 60000;
  const tm = [...snap.trademe].sort((a, b) => b.watchers - a.watchers || b.views - a.views);
  const waiting = snap.inbox.filter((r) => r.status === "waiting");

  return (
    <div className={`min-h-screen ${C.page}`}>
      <div className="max-w-5xl mx-auto px-4 pt-6 pb-16 lg:px-8 space-y-8">
        <header className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-[30px] font-extrabold tracking-tight">运营</h1>
            <button onClick={load} aria-label="刷新"
              className="flex items-center gap-1.5 h-11 px-4 rounded-full bg-white font-semibold active:opacity-70">
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              <span className={ageMin > 90 ? C.bad : C.soft}>{when(snap.built).slice(6)}</span>
            </button>
          </div>
          {ageMin > 90 && <Banner>超过 90 分钟没更新，检查服务器推送</Banner>}
          <nav className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 [scrollbar-width:none]">
            {([["/orders", "订单", Receipt], ["/catalog", "商品", Tag], ["/photos", "照片", Camera], ["/team", "bot", Bot], ["/", "首页", Home]] as [string, string, LucideIcon][]).map(([href, name, I]) => (
              <a key={href} href={href} className="flex shrink-0 items-center gap-1.5 h-10 px-4 rounded-full bg-white font-semibold active:opacity-70">
                <I className={`w-4 h-4 ${C.accent}`} />{name}
              </a>
            ))}
          </nav>
        </header>

        {/* The first screen: what is off target, as tiles; or one green tile. */}
        <section aria-label="没达标">
          {bad.length === 0 ? (
            <div className={`${C.card} p-5 flex items-center gap-3`}>
              <CheckCircle2 className={`w-10 h-10 ${C.good}`} />
              <span className="text-xl font-bold">全部达标</span>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {bad.map((m) => <BigTile key={m.id} m={m} />)}
            </div>
          )}
        </section>

        {snap.sources && (
          <div className="flex flex-wrap gap-2" aria-label="数据来源">
            {Object.entries(snap.sources).map(([k, s]) => (
              <span key={k} title={s.ok ? `更新于 ${when(s.at)}` : `更新失败，数据停在 ${when(s.at)}${s.error ? `：${s.error}` : ""}`}
                className={`flex items-center gap-1.5 h-9 px-3 rounded-full font-semibold ${s.ok ? "bg-white" : "bg-[#fde8dc] text-[#9a3412]"}`}>
                <span className={`w-2.5 h-2.5 rounded-full ${s.ok ? "bg-[#16a34a]" : "bg-[#c2410c]"}`} />
                {SOURCE_NAMES[k] ?? k}{!s.ok && " 断了"}
              </span>
            ))}
            {!hasDb && <span className={`flex items-center h-9 px-3 ${C.soft}`}>趋势要连数据库</span>}
          </div>
        )}

        {rules.length > 0 && (
          <Section title="规矩" icon={CheckCircle2} note="Notion 里定的规矩，以及现在守住没有。点一条看全文。">
            <div className={`${C.card} divide-y divide-[#e3dfd6]`}>
              {rules.map((rule) => {
                const ms = metrics.filter((m) => m.rule === rule);
                const broken = ms.some((m) => m.status === "bad");
                const lead = ms.find((m) => m.status === "bad") ?? ms[0];
                return (
                  <details key={rule} className="group">
                    <summary className="flex items-center gap-3 px-4 py-3.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      {broken ? <XCircle className={`w-7 h-7 shrink-0 ${C.bad}`} /> : <CheckCircle2 className={`w-7 h-7 shrink-0 ${C.good}`} />}
                      <span className="flex-1 min-w-0 truncate group-open:whitespace-normal font-medium">{rule}</span>
                      <span className={`shrink-0 text-xl font-extrabold tabular-nums ${broken ? C.bad : C.good}`}>{fmt(lead, lead.value)}</span>
                    </summary>
                    <div className={`px-4 pb-3.5 pl-14 text-sm ${C.soft}`}>
                      {ms.map((m) => <div key={m.id}>{m.label}：{fmt(m, m.value)}（目标 {target(m)}）</div>)}
                    </div>
                  </details>
                );
              })}
            </div>
          </Section>
        )}

        <Section title="各岗位" icon={Bot} note="每个指标：现在的值、目标、30 天趋势。定义在 driftae-ops 的 org/metrics.json。没有独立 agent 的岗位由营销 agent 代管。">
          <div className="space-y-4">
            {ROLES.map(([role, name, I]) => {
              const ms = metrics.filter((m) => m.role === role);
              if (!ms.length) return null;
              return (
                <div key={role} className={`${C.card} p-4`}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-full bg-[#f7ede3]"><I className={`w-5 h-5 ${C.accent}`} /></span>
                    <span className="text-lg font-bold">{name}</span>
                    {teamStatus(role) === "planned" && <span className={`text-sm ${C.soft}`}>· 代管</span>}
                  </div>
                  <div className="grid grid-cols-2 lg:grid-cols-3 gap-2">
                    {ms.map((m) => <MetricTile key={m.id} m={m} points={series(m.id)} />)}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>

        <Section title="私信" icon={MessageCircle} note="从客户第一条未回复的消息算到主页回复；自动回复不算。橙色 = 超过 1 小时。已放弃 = 你在微信回了“放弃 码”，客人再发消息会重新提醒。">
          <div className="grid grid-cols-2 gap-3">
            <Stat icon={Clock} n={waiting.length} unit="位" label="在等回复" tone={waiting.length ? "bad" : "good"} />
            <Stat icon={MessageCircle} n={Math.round(Math.max(0, ...waiting.map((r) => r.minutes)))} unit="分钟" label="最久等了" tone={waiting.some((r) => r.minutes > 60) ? "bad" : "good"} />
          </div>
          <BarList
            max={Math.max(...snap.inbox.map((x) => x.minutes), 1)}
            rows={[...snap.inbox]
              .sort((a, b) => (a.status === b.status ? b.asked.localeCompare(a.asked) : a.status === "waiting" ? -1 : b.status === "waiting" ? 1 : 0))
              .map((r) => ({
                key: r.conversation + r.asked,
                icon: r.status === "waiting" ? "⏳" : r.status === "dismissed" ? "✕" : "✓",
                label: when(r.asked),
                value: r.minutes,
                text: `${Math.round(r.minutes)} 分`,
                hot: r.status === "waiting" || r.minutes > 60,
                dim: r.status === "dismissed",
              }))}
          />
        </Section>

        <Section title="从看到广告到下单" icon={Megaphone} note="广告投放以来。订单是所有渠道的，未区分是否来自广告。">
          <div className={`${C.card} p-4`}><Funnel steps={funnel(snap)} /></div>
        </Section>

        <Section title="每条广告" icon={Megaphone} note="投放以来。大数字 = 每个私信对话花多少钱，越低越好。展示不到 1,000 次的先不下结论。">
          <div className="grid sm:grid-cols-2 gap-3">
            {snap.ads.filter((a) => a.window === "lifetime").map((a) => (
              <div key={a.ad} className={`${C.card} p-4 space-y-2`}>
                <div className="flex items-center gap-2">
                  <span className={`w-2.5 h-2.5 shrink-0 rounded-full ${a.status === "ACTIVE" ? "bg-[#16a34a]" : "bg-[#c9c4ba]"}`} />
                  <span className="flex-1 min-w-0 truncate font-semibold">{a.ad}</span>
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[28px] font-extrabold tabular-nums">{a.cost_per_conversation === null ? "—" : money(a.cost_per_conversation)}</span>
                  <span className={C.soft}>/ 对话</span>
                </div>
                <div className={`flex flex-wrap gap-x-3 gap-y-1 text-sm ${C.soft}`}>
                  <span>💬 {a.conversations}</span>
                  <span>👁 {a.impressions.toLocaleString()}</span>
                  <span>💸 {money(a.spend)}</span>
                  <span>日 {money(a.daily_budget)}</span>
                </div>
                {(a.tag_theme || a.tag_creative) && (
                  <div className="flex flex-wrap gap-1.5">
                    {[a.tag_theme, a.tag_creative].filter(Boolean).map((t) => <Chip key={t}>{t}</Chip>)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        {snap.ad_race?.ads?.length ? (
          <Section title={`广告赛马 · 头 ${snap.ad_race.days} 天`} icon={Trophy}
            note={`不同周投的广告按同样天数比。要跑满 ${snap.ad_race.days} 天、展示过 1,000 次才算数；每个对话越便宜越好。🏆 = 目前领先。微信里问 bot 要「赛马卡」。`}>
            <BarList
              max={Math.max(...snap.ad_race.ads.map((r) => r.cost_per_conversation ?? 0), 1)}
              rows={snap.ad_race.ads.map((r) => ({
                key: r.ad,
                icon: r.ad === snap.ad_race?.leader ? "🏆" : r.done && r.enough_data ? "🏁" : "⏳",
                label: raceLabel(r),
                sub: raceState(r, snap.ad_race!.days),
                value: r.cost_per_conversation ?? 0,
                text: r.cost_per_conversation === null ? "—" : `${money(r.cost_per_conversation)}/对话`,
                good: r.ad === snap.ad_race?.leader,
              }))}
            />
          </Section>
        ) : null}

        <Section title="Trade Me" icon={Tag} note={`按关注数排序。有关注没成交 = 犹豫，考虑报价；浏览少 = 标题或图片要改。同步于 ${when(tm[0]?.synced)}`}>
          {snap.trademe_ended_early && snap.trademe_ended_early.length > 0 && (
            <div className={`${C.card} p-4`}>
              <div className="flex items-center gap-2 mb-2 font-bold"><CheckCircle2 className={`w-5 h-5 ${C.good}`} />提前下架（多为成交）</div>
              <ul className="space-y-1.5">
                {[...snap.trademe_ended_early].reverse().slice(0, 10).map((e) => (
                  <li key={e.listing_id + e.seen_gone} className="flex items-center gap-3">
                    <span className="flex-1 min-w-0 truncate">{e.title}</span>
                    <span className="font-bold tabular-nums">${e.price}</span>
                    <span className={`text-sm tabular-nums ${C.soft}`}>{when(e.seen_gone).slice(0, 5)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className={`${C.card} divide-y divide-[#e3dfd6]`}>
            {tm.map((r) => {
              const max = Math.max(...tm.map((x) => x.views), 1);
              return (
                <a key={r.listing_id} href={`https://www.trademe.co.nz/a/listing/${r.listing_id}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-3 active:bg-[#ece8e0]">
                  <span className="flex-1 min-w-0">
                    <span className="block truncate font-medium">{r.title}</span>
                    <span className="mt-1.5 block h-2 rounded-full bg-[#ece8e0]">
                      <span className={`block h-2 rounded-full ${r.views < 10 ? "bg-[#c2410c]" : "bg-[#16161a]"}`} style={{ width: `${Math.max(3, (100 * r.views) / max)}%` }} />
                    </span>
                  </span>
                  <span className={`flex items-center gap-1 tabular-nums text-sm ${C.soft}`}><Eye className="w-4 h-4" />{r.views}</span>
                  <span className={`flex w-12 items-center gap-1 tabular-nums font-bold ${r.watchers >= 3 ? C.bad : ""}`}><Heart className="w-4 h-4" />{r.watchers}</span>
                  <span className="w-14 text-right font-bold tabular-nums">${r.price}</span>
                </a>
              );
            })}
          </div>
        </Section>

        {snap.trademe_daily && snap.trademe_daily.rows.length > 0 && <TradeMeDaily daily={snap.trademe_daily} />}

        <Section title="订单" icon={Receipt} note="每月合计，不含已取消。深色 = 销售额，橙色 = 毛利。">
          <Months rows={snap.orders_monthly} />
          <a href="/books" className={`inline-flex items-center h-11 px-4 rounded-full bg-white font-semibold ${C.accent}`}>每单怎么算 · 账本 ›</a>
        </Section>

        <Section title="团队与审批" icon={UserCheck} note="近 30 天。干活 = 起草、建广告、写知识库；巡检 = 查收件箱、查账户。审批用时 = agent 发审批码到批准。">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {snap.team.map((r) => {
              const I = roleIcon(r.role);
              return (
                <div key={r.role} className={`${C.card} p-4 space-y-1`}>
                  <div className="flex items-center gap-2 font-bold">
                    <I className={`w-5 h-5 ${C.accent}`} />{ROLES.find(([k]) => k === r.role)?.[1] ?? r.role}
                    <span className={`ml-auto w-2.5 h-2.5 rounded-full ${r.status === "active" ? "bg-[#16a34a]" : "bg-[#c9c4ba]"}`} />
                  </div>
                  <div className="text-[26px] font-extrabold tabular-nums">{r.actions}<span className={`text-sm font-medium ${C.soft}`}> 干活 · {r.checks} 巡检</span></div>
                  <div className={`text-sm ${C.soft}`}>最近 {when(r.last_action)}</div>
                </div>
              );
            })}
          </div>
          {snap.approvals.length > 0 && (
            <BarList
              max={Math.max(...snap.approvals.map((r) => r.minutes ?? 0), 1)}
              rows={[...snap.approvals].reverse().map((r) => ({
                key: r.requested + r.kind,
                icon: r.minutes === null ? "⏳" : "✓",
                label: r.kind === "Messenger reply" ? "Messenger 回复" : r.kind,
                sub: when(r.requested),
                value: r.minutes ?? 0,
                text: r.minutes === null ? "未批" : `${r.minutes} 分`,
                hot: r.minutes === null,
              }))}
            />
          )}
        </Section>
      </div>
    </div>
  );
}

function funnel(snap: Snapshot): [string, number][] {
  const sum = (k: "impressions" | "link_clicks" | "conversations") => snap.ads_daily.reduce((t, r) => t + (r[k] || 0), 0);
  const first = snap.ads_daily.map((r) => r.day).sort()[0] ?? "9999";
  const orders = snap.orders_daily.filter((r) => r.day >= first).reduce((t, r) => t + r.orders, 0);
  return [["👁 展示", sum("impressions")], ["👆 点击", sum("link_clicks")], ["💬 私信", sum("conversations")], ["🛒 订单", orders]];
}

/** Off target: the role's icon, the number big, what it should be under it. */
function BigTile({ m }: { m: Metric }) {
  const I = roleIcon(m.role);
  return (
    <div className={`${C.card} p-4 border-2 border-[#c2410c] flex flex-col gap-1`} title={m.description}>
      <I className={`w-7 h-7 ${C.bad}`} />
      <span className={`text-[32px] leading-tight font-extrabold tabular-nums ${C.bad}`}>{fmt(m, m.value)}</span>
      <span className="font-semibold leading-snug">{m.label}</span>
      <span className={`text-sm ${C.soft}`}>目标 {target(m)}</span>
    </div>
  );
}

function MetricTile({ m, points }: { m: Metric; points: Point[] }) {
  const tone = m.status === "bad" ? C.bad : m.status === "ok" ? C.good : m.status === "unknown" ? "text-[#a8a397]" : "";
  return (
    <div className="rounded-2xl bg-[#f5f3ee] p-3 flex flex-col gap-0.5 min-w-0" title={m.description}>
      <span className="flex items-center gap-1">
        {m.status === "bad" ? <XCircle className={`w-4 h-4 ${C.bad}`} /> : m.status === "ok" ? <CheckCircle2 className={`w-4 h-4 ${C.good}`} /> : null}
        <span className={`text-[22px] font-extrabold tabular-nums ${tone}`}>{fmt(m, m.value)}</span>
      </span>
      <span className="text-sm font-medium leading-snug">{m.label}{m.stale && <span className={C.bad}> · 过期</span>}</span>
      <span className="flex items-center justify-between gap-2">
        <span className={`text-xs ${C.soft}`}>目标 {target(m)}</span>
        <Spark points={points} />
      </span>
    </div>
  );
}

function Stat({ icon: I, n, unit, label, tone }: { icon: LucideIcon; n: number; unit: string; label: string; tone: "good" | "bad" }) {
  return (
    <div className={`${C.card} p-4 flex flex-col gap-1`}>
      <I className={`w-6 h-6 ${tone === "bad" ? C.bad : C.good}`} />
      <span className={`text-[32px] leading-tight font-extrabold tabular-nums ${tone === "bad" ? C.bad : ""}`}>{n}<span className={`text-base font-medium ${C.soft}`}> {unit}</span></span>
      <span className="font-semibold">{label}</span>
    </div>
  );
}

type BarRow = { key: string; icon: string; label: string; sub?: string; value: number; text: string; hot?: boolean; good?: boolean; dim?: boolean };

/** One line each: a mark, what, a bar for how much, the number. */
function BarList({ rows, max }: { rows: BarRow[]; max: number }) {
  if (!rows.length) return null;
  return (
    <div className={`${C.card} divide-y divide-[#e3dfd6]`}>
      {rows.map((r) => (
        <div key={r.key} className={`flex items-center gap-3 px-4 py-3 ${r.dim ? "opacity-50" : ""}`}>
          <span className="w-6 text-center text-lg">{r.icon}</span>
          <span className="flex-1 min-w-0">
            <span className="flex items-baseline gap-2">
              <span className="truncate font-medium">{r.label}</span>
              {r.sub && <span className={`shrink-0 text-xs ${C.soft}`}>{r.sub}</span>}
            </span>
            <span className="mt-1.5 block h-2 rounded-full bg-[#ece8e0]">
              <span className={`block h-2 rounded-full ${r.hot ? "bg-[#c2410c]" : r.good ? "bg-[#16a34a]" : "bg-[#16161a]"}`}
                style={{ width: `${Math.max(3, (100 * r.value) / max)}%` }} />
            </span>
          </span>
          <span className={`shrink-0 font-bold tabular-nums ${r.hot ? C.bad : r.good ? C.good : ""}`}>{r.text}</span>
        </div>
      ))}
    </div>
  );
}

/** Each month: a dark bar for sales, an orange one for profit, the numbers beside them. */
function Months({ rows }: { rows: Snapshot["orders_monthly"] }) {
  const list = [...rows].reverse().slice(0, 12);
  const max = Math.max(...list.map((r) => r.revenue), 1);
  return (
    <div className={`${C.card} p-4 space-y-3`}>
      {list.map((r) => (
        <div key={r.month} className="grid grid-cols-[3.2rem_1fr_auto] items-center gap-3">
          <span className="font-bold tabular-nums">{r.month.slice(2).replace("-", ".")}</span>
          <span className="space-y-1">
            <span className="block h-3 rounded-full bg-[#16161a]" style={{ width: `${Math.max(2, (100 * r.revenue) / max)}%` }} />
            <span className="block h-3 rounded-full bg-[#c2410c]" style={{ width: `${Math.max(1, (100 * Math.max(0, r.gross_profit)) / max)}%` }} />
          </span>
          <span className="text-right tabular-nums leading-tight">
            <span className="block font-bold">{money(r.revenue)}</span>
            <span className={`block text-sm font-semibold ${C.accent}`}>{money(r.gross_profit)}</span>
          </span>
        </div>
      ))}
      <div className={`text-sm ${C.soft}`}>🛒 {list.reduce((t, r) => t + r.orders, 0)} 单 · {list.length} 个月</div>
    </div>
  );
}

function Spark({ points }: { points: Point[] }) {
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  if (vals.length < 2) return null;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const xy = vals.map((v, i) => `${(i / (vals.length - 1)) * 60 + 2},${18 - ((v - min) / span) * 14}`).join(" ");
  const last = points[points.length - 1]?.status;
  return (
    <svg viewBox="0 0 64 20" className="w-16 h-5 shrink-0" aria-hidden="true">
      <polyline points={xy} fill="none" stroke={last === "bad" ? "#c2410c" : "#5e5b55"} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Views added each day per product (since the previous day's last sync), so a relist doesn't reset the line.
function TradeMeDaily({ daily }: { daily: NonNullable<Snapshot["trademe_daily"]> }) {
  const n = Math.min(7, daily.days.length);
  const days = daily.days.slice(-n);
  const max = Math.max(1, ...daily.rows.flatMap((r) => r.views.slice(-n).map((v) => v ?? 0)));
  return (
    <Section title="每天浏览" icon={Eye} note="每格 = 那天新增浏览，越橙越多。重新上架不清零（↻ = 那天重新上架）；空格 = 那天不在架。最后一天还没过完。">
      <div className={`${C.card} p-3 overflow-x-auto`}>
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th />
              {days.map((d) => <th key={d} className={`font-semibold tabular-nums ${C.soft}`}>{d.slice(8)}</th>)}
              <th className={`font-semibold ${C.soft}`}>7天</th>
            </tr>
          </thead>
          <tbody>
            {daily.rows.map((r) => {
              const views = r.views.slice(-n);
              return (
                <tr key={r.product_ids.join(",") || r.title} className={r.live ? "" : "opacity-40"}>
                  <td className="max-w-[9rem] truncate pr-1 font-medium">
                    <a href={`https://www.trademe.co.nz/a/listing/${r.listing_id}`} target="_blank" rel="noopener noreferrer">{r.title}</a>
                  </td>
                  {views.map((v, i) => (
                    <td key={days[i]} className="h-9 w-9 min-w-9 rounded-lg text-center tabular-nums font-semibold"
                      style={{ background: v === null ? "transparent" : v ? `rgba(194, 65, 12, ${0.1 + 0.75 * (v / max)})` : "#ece8e0", color: v && v / max > 0.5 ? "#fff" : undefined }}>
                      {v === null ? "" : r.relisted.includes(days[i]) ? `↻${v}` : v}
                    </td>
                  ))}
                  <td className="text-center font-extrabold tabular-nums">{views.reduce<number>((a, v) => a + (v ?? 0), 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className={`min-h-screen flex items-center justify-center p-4 ${C.page} ${C.soft}`}>{children}</div>;
}

function Banner({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl bg-[#fde8dc] px-4 py-3 font-semibold text-[#9a3412]">⚠️ {children}</div>;
}

function Chip({ children }: { children: React.ReactNode }) {
  return <span className="inline-flex h-7 items-center px-2.5 rounded-full bg-[#f5f3ee] text-sm font-medium">{children}</span>;
}

/** A heading with its icon; the explanation only when ⓘ is tapped. */
function Section({ title, icon: I, note, children }: { title: string; icon: LucideIcon; note?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <I className={`w-6 h-6 ${C.accent}`} />
        <h2 className="text-[22px] font-extrabold">{title}</h2>
        {note && (
          <button onClick={() => setOpen(!open)} aria-label="说明" aria-expanded={open}
            className={`ml-auto flex items-center justify-center w-11 h-11 rounded-full ${open ? "bg-white" : ""} ${C.soft}`}>
            <Info className="w-5 h-5" />
          </button>
        )}
      </div>
      {open && note && <p className={`rounded-2xl bg-white px-4 py-3 text-sm ${C.soft}`}>{note}</p>}
      {children}
    </section>
  );
}

/** Each step a bar (square-root scaled, so the small steps still show) and how many of the step before got through. */
function Funnel({ steps }: { steps: [string, number][] }) {
  const max = Math.max(...steps.map(([, n]) => n), 1);
  return (
    <div className="space-y-1">
      {steps.map(([name, n], i) => (
        <div key={name}>
          {i > 0 && (
            <div className={`pl-[5.5rem] text-sm font-semibold ${C.accent}`}>
              ↓ {steps[i - 1][1] ? `${((100 * n) / steps[i - 1][1]).toFixed(1)}%` : "—"}
            </div>
          )}
          <div className="grid grid-cols-[5rem_1fr_4.5rem] items-center gap-2">
            <span className="font-semibold">{name}</span>
            <span className="h-7 rounded-full bg-[#ece8e0]">
              <span className="block h-7 rounded-full bg-[#16161a]" style={{ width: `${Math.max(2, Math.sqrt(n / max) * 100)}%` }} />
            </span>
            <span className="text-right text-lg font-extrabold tabular-nums">{n.toLocaleString()}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
