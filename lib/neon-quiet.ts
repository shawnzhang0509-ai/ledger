import { getKvClient } from "@/lib/kv";

// Neon bills by the minute it is awake and sleeps after 5 idle minutes. The driftae-ops server asks for the mail outboxes
// every 2 minutes and Messenger referrals every 5, so it never slept and the free 100 CU-hours ran out (owner
// 2026-11-28: every Neon route 500, "exceeded the quota"). These keep those polls in Redis: the database is asked only
// when something was queued since, or once an hour to be safe; if Redis fails, the database is asked as before.

type Outbox = "giveaway" | "subscribe";
const pending = (o: Outbox) => `neon-quiet:${o}:pending`;
const looked = (o: Outbox) => `neon-quiet:${o}:looked`;

/** A mail was queued in the database: the next outbox poll looks there. */
export async function mailQueued(o: Outbox) {
  try {
    await getKvClient().set(pending(o), "1");
  } catch {}
}

/** An outbox from the database, or [] without waking it when nothing was queued (and it was looked at within the hour). */
export async function quietOutbox<T>(o: Outbox, read: () => Promise<T[]>): Promise<T[]> {
  try {
    const kv = getKvClient();
    const [was, recent] = await Promise.all([kv.getdel(pending(o)), kv.get(looked(o))]);
    if (!was && recent) return [];
    await kv.set(looked(o), "1", { ex: 3600 });
  } catch {
    return read();
  }
  const rows = await read();
  if (rows.length) await mailQueued(o); // not marked mailed yet: look again next time (until the poll finds none)
  return rows;
}

const REFERRALS = "neon-quiet:referrals";

/** Messenger referrals after an id, kept in Redis until the webhook saves new ones. */
export async function quietReferrals<T>(after: number, read: () => Promise<T[]>): Promise<T[]> {
  try {
    const kv = getKvClient();
    const ver = (await kv.get<number>(`${REFERRALS}:ver`)) ?? 0;
    const key = `${REFERRALS}:${ver}:${after}`;
    const hit = await kv.get<T[]>(key);
    if (hit) return hit;
    const rows = await read();
    await kv.set(key, rows, { ex: 6 * 3600 });
    return rows;
  } catch {
    return read();
  }
}

/** New referrals were saved: the next read goes to the database. */
export async function referralsChanged() {
  try {
    await getKvClient().incr(`${REFERRALS}:ver`);
  } catch {}
}
