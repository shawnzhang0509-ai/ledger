import { Order } from "@/lib/data";
import { Truck } from "lucide-react";
import { PROMISED_DAYS, SLOW_DAYS, CycleStat, deliveryCycle } from "@/lib/delivery";

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// 交付周期: sold → local waybill, sold → delivered, against the "approximately 2 weeks" in the descriptions.
export function DeliveryCycle({ orders }: { orders: Order[] }) {
  const c = deliveryCycle(orders);
  const scale = Math.max(SLOW_DAYS, c.deliver?.max ?? 0, c.ship?.max ?? 0) * 1.1;
  const pct = (d: number) => `${Math.min(100, (d / scale) * 100)}%`;
  const bars: { label: string; s: CycleStat | null }[] = [
    { label: "发货", s: c.ship },
    { label: "送到客人", s: c.deliver },
  ];
  if (!c.ship && !c.deliver) {
    return (
      <div className="flex items-center gap-2 rounded-full bg-white px-4 h-11 text-sm font-semibold text-[#5e5b55]">
        <Truck className="w-5 h-5" />交付天数：还没有发货日期
      </div>
    );
  }
  // big average days, a bar against the 14 days promised (green line) and 21 (orange line)
  return (
    <div className="rounded-[24px] bg-white p-4 space-y-4" title={`有日期的 ${c.rows.length}/${c.total} 单；缺日期的不计`}>
      {bars.map(({ label, s }) => (
        <div key={label} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <Truck className="w-5 h-5 self-center text-[#c2410c]" />
            <span className="font-semibold">{label}</span>
            <span className={`ml-auto text-[26px] font-extrabold tabular-nums ${s && s.avg > PROMISED_DAYS ? "text-[#c2410c]" : "text-[#15803d]"}`}>
              {s ? `${fmt(s.avg)} 天` : "—"}
            </span>
          </div>
          <div className="relative h-3 rounded-full bg-[#ece8e0]">
            {s && <div className="absolute h-3 rounded-full bg-[#16161a]" style={{ width: pct(s.avg) }} />}
            <div className="absolute -top-1 h-5 border-l-[3px] border-[#16a34a]" style={{ left: pct(PROMISED_DAYS) }} />
            <div className="absolute -top-1 h-5 border-l-[3px] border-[#c2410c]" style={{ left: pct(SLOW_DAYS) }} />
          </div>
          {s && <div className="text-sm text-[#5e5b55]">{s.n} 单 · 最长 {fmt(s.max)} 天 · 承诺 {PROMISED_DAYS} 天</div>}
        </div>
      ))}
      {c.slow.length > 0 && (
        <div className="text-sm font-semibold text-[#c2410c]">超过 {SLOW_DAYS} 天：{c.slow.map((r) => `${r.orderId}（${fmt(r.toDeliver ?? 0)} 天）`).join("、")}</div>
      )}
    </div>
  );
}
