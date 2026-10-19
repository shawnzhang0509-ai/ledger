import { neon } from "@neondatabase/serverless";

// Postgres (Neon, connected in Vercel → Storage) keeps the history of the ops metrics.
// Without it the dashboard still works from the latest snapshot in Redis, just without trends.

export type MetricPoint = { metric_id: string; day: string; value: number | null; status: string };

function client() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  return url ? neon(url) : null;
}

export const hasDatabase = () => client() !== null;

let schemaReady = false;

async function ensureSchema(sql: NonNullable<ReturnType<typeof client>>) {
  if (schemaReady) return;
  await sql`CREATE TABLE IF NOT EXISTS ops_snapshots (
    built_at timestamptz PRIMARY KEY,
    payload jsonb NOT NULL
  )`;
  await sql`CREATE TABLE IF NOT EXISTS ops_metric_values (
    metric_id text NOT NULL,
    built_at timestamptz NOT NULL,
    value double precision,
    target double precision,
    status text NOT NULL,
    PRIMARY KEY (metric_id, built_at)
  )`;
  schemaReady = true;
}

type PushedMetric = { id: string; value: number | null; target: number | null; status: string };

/** Store one pushed snapshot and its metric values; drop history older than 400 days. */
export async function saveSnapshot(builtAt: string, payload: unknown, metrics: PushedMetric[]) {
  const sql = client();
  if (!sql) return false;
  await ensureSchema(sql);
  await sql.transaction([
    sql`INSERT INTO ops_snapshots (built_at, payload) VALUES (${builtAt}, ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT (built_at) DO NOTHING`,
    ...metrics.map((m) => sql`INSERT INTO ops_metric_values (metric_id, built_at, value, target, status)
        VALUES (${m.id}, ${builtAt}, ${m.value}, ${m.target}, ${m.status})
        ON CONFLICT (metric_id, built_at) DO NOTHING`),
    sql`DELETE FROM ops_snapshots WHERE built_at < now() - interval '400 days'`,
    sql`DELETE FROM ops_metric_values WHERE built_at < now() - interval '400 days'`,
  ]);
  return true;
}

/** The last value of each metric per day (NZ time), for the trend lines. */
export async function metricHistory(days = 30): Promise<MetricPoint[]> {
  const sql = client();
  if (!sql) return [];
  await ensureSchema(sql);
  const rows = await sql`
    SELECT metric_id,
           to_char(built_at AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM-DD') AS day,
           (array_agg(value ORDER BY built_at DESC))[1] AS value,
           (array_agg(status ORDER BY built_at DESC))[1] AS status
    FROM ops_metric_values
    WHERE built_at > now() - make_interval(days => ${days})
    GROUP BY metric_id, day
    ORDER BY day`;
  return rows as MetricPoint[];
}

// ---------- product photos uploaded by the team (files live in R2, this is the index) ----------

export type Photo = {
  id: number; key: string; url: string; product_id: string | null; product_name: string | null;
  note: string | null; width: number; height: number; uploaded_by: string; created_at: string;
};

let photosReady = false;

async function ensurePhotos(sql: NonNullable<ReturnType<typeof client>>) {
  if (photosReady) return;
  await sql`CREATE TABLE IF NOT EXISTS photos (
    id bigserial PRIMARY KEY,
    key text UNIQUE NOT NULL,
    url text NOT NULL,
    product_id text,
    product_name text,
    note text,
    width int NOT NULL,
    height int NOT NULL,
    uploaded_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE photos ADD COLUMN IF NOT EXISTS deleted_at timestamptz`;
  photosReady = true;
}

export async function addPhoto(p: Omit<Photo, "id" | "created_at">) {
  const sql = client();
  if (!sql) throw new Error("DATABASE_NOT_CONFIGURED");
  await ensurePhotos(sql);
  await sql`INSERT INTO photos (key, url, product_id, product_name, note, width, height, uploaded_by)
            VALUES (${p.key}, ${p.url}, ${p.product_id}, ${p.product_name}, ${p.note}, ${p.width}, ${p.height}, ${p.uploaded_by})
            ON CONFLICT (key) DO NOTHING`;
}

/** Newest first; `afterId` lets the driftae-ops server fetch only what it hasn't seen. */
export async function listPhotos(afterId = 0, limit = 100): Promise<Photo[]> {
  const sql = client();
  if (!sql) return [];
  await ensurePhotos(sql);
  return (await sql`SELECT id, key, url, product_id, product_name, note, width, height, uploaded_by,
                           to_char(created_at AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM-DD"T"HH24:MI') AS created_at
                    FROM photos WHERE id > ${afterId} AND deleted_at IS NULL ORDER BY id DESC LIMIT ${limit}`) as Photo[];
}

/** Marks a photo deleted and returns its R2 key (the row stays so the agent learns it's gone). */
export async function markPhotoDeleted(id: number): Promise<string | null> {
  const sql = client();
  if (!sql) return null;
  await ensurePhotos(sql);
  const rows = await sql`UPDATE photos SET deleted_at = now() WHERE id = ${id} AND deleted_at IS NULL RETURNING key`;
  return (rows[0]?.key as string) ?? null;
}

export async function listDeletedPhotos(since: string): Promise<{ id: number; url: string; deleted_at: string }[]> {
  const sql = client();
  if (!sql) return [];
  await ensurePhotos(sql);
  return (await sql`SELECT id, url, to_char(deleted_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS deleted_at FROM photos
                    WHERE deleted_at > ${since}::timestamptz ORDER BY deleted_at`) as { id: number; url: string; deleted_at: string }[];
}

// ---------- catalogue prices: the owner's price is the approval to list / reprice on Trade Me ----------

export type CatalogPrice = { product_id: string; price: number | null; list_on_trademe: boolean; title: string | null;
  updated_at: string; updated_by: string };
export type CatalogStatus = { product_id: string; state: string; listing_id: number | null; tm_price: number | null;
  message: string | null; title: string | null; at: string };

let catalogReady = false;

async function ensureCatalog(sql: NonNullable<ReturnType<typeof client>>) {
  if (catalogReady) return;
  await sql`CREATE TABLE IF NOT EXISTS catalog_prices (
    product_id text PRIMARY KEY, price numeric(10,2), list_on_trademe boolean NOT NULL DEFAULT false,
    title text, updated_at timestamptz NOT NULL DEFAULT now(), updated_by text NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS catalog_status (
    product_id text PRIMARY KEY, state text NOT NULL, listing_id bigint, tm_price numeric(10,2),
    message text, title text, at text NOT NULL)`;
  catalogReady = true;
}

export async function catalogData(): Promise<{ prices: CatalogPrice[]; status: CatalogStatus[] }> {
  const sql = client();
  if (!sql) throw new Error("DATABASE_NOT_CONFIGURED");
  await ensureCatalog(sql);
  const prices = await sql`SELECT product_id, price::float AS price, list_on_trademe, title,
      to_char(updated_at AT TIME ZONE 'Pacific/Auckland', 'YYYY-MM-DD"T"HH24:MI') AS updated_at, updated_by
    FROM catalog_prices`;
  const status = await sql`SELECT product_id, state, listing_id::text AS listing_id, tm_price::float AS tm_price, message, title, at
    FROM catalog_status`;
  return { prices: prices as CatalogPrice[], status: status as CatalogStatus[] };
}

export async function setCatalogPrice(p: Omit<CatalogPrice, "updated_at">) {
  const sql = client();
  if (!sql) throw new Error("DATABASE_NOT_CONFIGURED");
  await ensureCatalog(sql);
  await sql`INSERT INTO catalog_prices (product_id, price, list_on_trademe, title, updated_by, updated_at)
            VALUES (${p.product_id}, ${p.price}, ${p.list_on_trademe}, ${p.title}, ${p.updated_by}, now())
            ON CONFLICT (product_id) DO UPDATE SET price = EXCLUDED.price, list_on_trademe = EXCLUDED.list_on_trademe,
              title = EXCLUDED.title, updated_by = EXCLUDED.updated_by, updated_at = now()`;
}

export async function saveCatalogStatus(rows: CatalogStatus[]) {
  const sql = client();
  if (!sql) throw new Error("DATABASE_NOT_CONFIGURED");
  await ensureCatalog(sql);
  await sql.transaction(rows.map((r) => sql`INSERT INTO catalog_status (product_id, state, listing_id, tm_price, message, title, at)
      VALUES (${r.product_id}, ${r.state}, ${r.listing_id}, ${r.tm_price}, ${r.message}, ${r.title}, ${r.at})
      ON CONFLICT (product_id) DO UPDATE SET state = EXCLUDED.state, listing_id = EXCLUDED.listing_id,
        tm_price = EXCLUDED.tm_price, message = EXCLUDED.message, title = EXCLUDED.title, at = EXCLUDED.at`));
}

// ---------- where a Messenger conversation came from (ad / m.me?ref=), from Meta's webhook ----------

export type MessengerReferral = { id: number; psid: string; source: string | null; type: string | null; ref: string | null;
  ad_id: string | null; ad_title: string | null; at: string };

let referralsReady = false;

async function ensureReferrals(sql: NonNullable<ReturnType<typeof client>>) {
  if (referralsReady) return;
  await sql`CREATE TABLE IF NOT EXISTS messenger_referrals (
    id bigserial PRIMARY KEY, psid text NOT NULL, source text, type text, ref text, ad_id text, ad_title text,
    at timestamptz NOT NULL, UNIQUE (psid, at))`;
  // rows saved before seconds-timestamps were handled landed in January 1970
  await sql`UPDATE messenger_referrals SET at = to_timestamp(extract(epoch FROM at) * 1000)
            WHERE at < '2000-01-01'`;
  referralsReady = true;
}

export async function saveReferrals(rows: Omit<MessengerReferral, "id">[]) {
  const sql = client();
  if (!sql || !rows.length) return;
  await ensureReferrals(sql);
  await sql.transaction(rows.map((r) => sql`INSERT INTO messenger_referrals (psid, source, type, ref, ad_id, ad_title, at)
      VALUES (${r.psid}, ${r.source}, ${r.type}, ${r.ref}, ${r.ad_id}, ${r.ad_title}, ${r.at}::timestamptz)
      ON CONFLICT (psid, at) DO NOTHING`));
}

export async function listReferrals(afterId = 0, limit = 500): Promise<MessengerReferral[]> {
  const sql = client();
  if (!sql) return [];
  await ensureReferrals(sql);
  return (await sql`SELECT id, psid, source, type, ref, ad_id, ad_title,
                           to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at
                    FROM messenger_referrals WHERE id > ${afterId} ORDER BY id LIMIT ${limit}`) as MessengerReferral[];
}

// Email list (owner 2026-10-19): customers who said yes to new-arrival and members-only emails, from Messenger
// (the bot's one pre-approved question) or the website form. NZ's Unsolicited Electronic Messages Act: consent first,
// how it was given is kept (consent_text, source, consented_at), and an unsubscribe stops mail at once.
export type Subscriber = {
  email: string; source: string; consent_text: string | null; consented_at: string; token: string;
};

let subscribersReady = false;

async function ensureSubscribers(sql: NonNullable<ReturnType<typeof client>>) {
  if (subscribersReady) return;
  await sql`CREATE TABLE IF NOT EXISTS subscribers (
    email text PRIMARY KEY, source text NOT NULL, consent_text text, psid text, added_by text,
    consented_at timestamptz NOT NULL DEFAULT now(), unsubscribed_at timestamptz,
    token text NOT NULL UNIQUE)`;
  subscribersReady = true;
}

/** Add or re-confirm a subscriber. A fresh yes after an unsubscribe counts as new consent. */
export async function addSubscriber(s: { email: string; source: string; consent_text?: string | null; psid?: string | null;
  added_by?: string | null; token: string }) {
  const sql = client();
  if (!sql) throw new Error("DATABASE_NOT_CONFIGURED");
  await ensureSubscribers(sql);
  const rows = await sql`INSERT INTO subscribers (email, source, consent_text, psid, added_by, token)
    VALUES (${s.email}, ${s.source}, ${s.consent_text ?? null}, ${s.psid ?? null}, ${s.added_by ?? null}, ${s.token})
    ON CONFLICT (email) DO UPDATE SET source = EXCLUDED.source, consent_text = EXCLUDED.consent_text,
      psid = COALESCE(EXCLUDED.psid, subscribers.psid), added_by = EXCLUDED.added_by,
      consented_at = now(), unsubscribed_at = NULL
    RETURNING (xmax = 0) AS inserted`;
  return Boolean((rows[0] as { inserted?: boolean } | undefined)?.inserted);
}

export async function activeSubscribers(): Promise<Subscriber[]> {
  const sql = client();
  if (!sql) return [];
  await ensureSubscribers(sql);
  return (await sql`SELECT email, source, consent_text, token,
      to_char(consented_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS consented_at
    FROM subscribers WHERE unsubscribed_at IS NULL ORDER BY consented_at`) as Subscriber[];
}

export async function subscriberCounts() {
  const sql = client();
  if (!sql) return { active: 0, unsubscribed: 0 };
  await ensureSubscribers(sql);
  const [r] = (await sql`SELECT count(*) FILTER (WHERE unsubscribed_at IS NULL)::int AS active,
    count(*) FILTER (WHERE unsubscribed_at IS NOT NULL)::int AS unsubscribed FROM subscribers`) as
    { active: number; unsubscribed: number }[];
  return r;
}

/** Unsubscribe by the token in each email's link; true when it matched someone still subscribed. */
export async function unsubscribe(token: string) {
  const sql = client();
  if (!sql || !token) return false;
  await ensureSubscribers(sql);
  const rows = await sql`UPDATE subscribers SET unsubscribed_at = now()
    WHERE token = ${token} AND unsubscribed_at IS NULL RETURNING email`;
  return rows.length > 0;
}

/** A customer asked us (Messenger or email) to stop: same effect as the link. */
export async function unsubscribeEmail(email: string) {
  const sql = client();
  if (!sql || !email) return false;
  await ensureSubscribers(sql);
  const rows = await sql`UPDATE subscribers SET unsubscribed_at = now()
    WHERE email = ${email} AND unsubscribed_at IS NULL RETURNING email`;
  return rows.length > 0;
}
