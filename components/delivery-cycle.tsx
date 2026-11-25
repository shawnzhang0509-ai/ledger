import { Order } from "@/lib/data";
import { PROMISED_DAYS, SLOW_DAYS, CycleStat, deliveryCycle } from "@/lib/delivery";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// 交付周期: sold → local waybill, sold → delivered, against the "approximately 2 weeks" in the descriptions.
export function DeliveryCycle({ orders }: { orders: Order[] }) {
  const c = deliveryCycle(orders);
  const scale = Math.max(SLOW_DAYS, c.deliver?.max ?? 0, c.ship?.max ?? 0) * 1.1;
  const pct = (d: number) => `${Math.min(100, (d / scale) * 100)}%`;
  const bars: { label: string; s: CycleStat | null }[] = [
    { label: "成交→发货", s: c.ship },
    { label: "成交→送达", s: c.deliver },
  ];
  const cell = (label: string, v: number | undefined, sign = false) => (
    <div>
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${!sign && v != null && v > SLOW_DAYS ? "text-red-600" : "text-slate-800"}`}>
        {v == null ? "—" : `${sign && v > 0 ? "+" : ""}${fmt(v)} 天`}
      </div>
    </div>
  );
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-800">交付周期（成交日起算）</h2>
        <span className="text-xs text-slate-400">有日期的 {c.rows.length}/{c.total} 单；缺日期的不计，不猜</span>
      </div>
      {bars.map(({ label, s }) => (
        <div key={label} className="mb-4">
          <div className="grid grid-cols-5 gap-3 items-end mb-2">
            <div className="text-sm font-medium text-slate-700">{label}{s ? `（${s.n} 单）` : ""}</div>
            {cell("平均", s?.avg)}
            {cell("中位", s?.median)}
            {cell("最长", s?.max)}
            {cell(`平均比承诺 ${PROMISED_DAYS} 天`, s ? s.avg - PROMISED_DAYS : undefined, true)}
          </div>
          <div className="relative h-3 bg-slate-100 rounded">
            {s && <div className="absolute h-3 rounded bg-sky-400" style={{ width: pct(s.avg) }} />}
            {s && <div className={`absolute h-1 bottom-0 rounded ${s.max > SLOW_DAYS ? "bg-red-500" : "bg-sky-700"}`} style={{ width: pct(s.max) }} />}
            <div className="absolute -top-1 h-5 border-l-2 border-emerald-600" style={{ left: pct(PROMISED_DAYS) }} title={`描述承诺 ${PROMISED_DAYS} 天`} />
            <div className="absolute -top-1 h-5 border-l-2 border-red-500" style={{ left: pct(SLOW_DAYS) }} title={`${SLOW_DAYS} 天`} />
          </div>
        </div>
      ))}
      <p className="text-xs text-slate-500">
        浅蓝=平均，深线=最长；绿线=描述承诺 approximately 2 weeks（{PROMISED_DAYS} 天），红线={SLOW_DAYS} 天，超过标红。
      </p>
      {c.slow.length > 0 && (
        <p className="text-xs text-red-600 mt-1">
          超过 {SLOW_DAYS} 天：{c.slow.map((r) => `${r.orderId}（${fmt(r.toDeliver ?? 0)} 天）`).join("、")}
        </p>
      )}
    </div>
  );
}
