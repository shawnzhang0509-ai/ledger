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
                    FROM photos WHERE id > ${afterId} ORDER BY id DESC LIMIT ${limit}`) as Photo[];
}
