// 广告赛马 (owner 2026-10-23: "一周以后我们看数据，公平赛马"): every ad over its own first N days with spend, so ads that
// ran in different weeks are compared on the same length. Computed by driftae-ops (`dt dashboard --push`, from Meta's
// daily insights) and stored in the ops snapshot as `ad_race`; the /ops page and the race card only show it.
export type AdRaceRow = {
  ad: string; name: string; started: string; days: number; done: boolean; status: string | null;
  spend: number; impressions: number; link_clicks: number; conversations: number;
  ctr_pct: number | null; cost_per_conversation: number | null; enough_data: boolean;
};
export type AdRace = { days: number; built: string; leader: string | null; ads: AdRaceRow[] };

export const raceLabel = (r: AdRaceRow) => r.name || r.ad;
export const raceState = (r: AdRaceRow, days: number) =>
  !r.done ? `跑到第 ${r.days}/${days} 天` : !r.enough_data ? "展示不到 1,000，先不比" : "可比";
