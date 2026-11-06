// 分账 (owner 2026-11-06): who put money into the business, who paid what for it, who holds its money. No profit split yet.
// Trade Me's money lands in 闪正's account, so what the books say came in counts as money she holds for the business.
export const PEOPLE = { shawn: "道长", wife: "闪正", stella: "Stella" } as const;
export type Person = keyof typeof PEOPLE;
export const SALES_ACCOUNT: Person = "wife";
export const KINDS = { capital: "出资", advance: "垫付", transfer: "转账" } as const;
export type Kind = keyof typeof KINDS;
export const COST_CATEGORIES = ["进货", "运费", "快递"];   // what the books count as a sale's costs

export type SplitEntry = {
  id: string; day: string; who: Person; kind: Kind;
  to: Person | null;            // transfer only: who received it
  category: string | null;      // 进货 / 运费 / 快递 / 广告 / 其他
  nzd: number; cny: number | null; rate: number | null;   // rate = CNY per NZD, kept as it was on the day
  what: string | null; order_id: string | null; by: string; at: string; voided: string | null;
};
export type PersonLine = {
  who: Person; name: string; capital: number; advance: number; sent: number; received: number; sales: number;
  balance: number;              // >0 the business owes them; <0 they hold the business's money. 出资 not included.
};
export type SplitReport = {
  people: PersonLine[]; sales_in: number; costs_in_books: number; costs_named: number; costs_unnamed: number;
  entries: SplitEntry[];
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function splitReport(rows: SplitEntry[], salesIn: number, costsInBooks: number): SplitReport {
  const live = rows.filter((e) => !e.voided);
  const sum = (f: (e: SplitEntry) => boolean) => r2(live.filter(f).reduce((t, e) => t + e.nzd, 0));
  const people = (Object.keys(PEOPLE) as Person[]).map((who) => {
    const capital = sum((e) => e.who === who && e.kind === "capital");
    const advance = sum((e) => e.who === who && e.kind === "advance");
    const sent = sum((e) => e.who === who && e.kind === "transfer");
    const received = sum((e) => e.to === who && e.kind === "transfer");
    const sales = who === SALES_ACCOUNT ? r2(salesIn) : 0;
    return { who, name: PEOPLE[who], capital, advance, sent, received, sales, balance: r2(advance + sent - received - sales) };
  });
  const named = sum((e) => e.kind === "advance" && COST_CATEGORIES.includes(e.category ?? ""));
  return { people, sales_in: r2(salesIn), costs_in_books: r2(costsInBooks), costs_named: named,
    costs_unnamed: r2(Math.max(0, costsInBooks - named)), entries: rows };
}
