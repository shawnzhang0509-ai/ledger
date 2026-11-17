import { createHash, createHmac } from "crypto";

// Cloudflare R2 speaks the S3 API. The browser uploads straight to R2 with a short-lived presigned URL,
// so photos never pass through (or hit the body limit of) a Vercel function, and the R2 keys stay here.

const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
const hmac = (key: Buffer | string, s: string) => createHmac("sha256", key).update(s).digest();
const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** AWS Signature V4 query-string presigning (generic, so it can be checked against AWS's published example). */
export function presign(opts: {
  method: string; host: string; path: string; region: string; accessKeyId: string; secretAccessKey: string;
  expires: number; now?: Date; query?: Record<string, string>;
}): string {
  const now = opts.now ?? new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${opts.region}/s3/aws4_request`;
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${opts.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(opts.expires),
    "X-Amz-SignedHeaders": "host",
    ...(opts.query ?? {}),
  };
  const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join("&");
  const path = opts.path.split("/").map(enc).join("/");
  const canonical = [opts.method, path, qs, `host:${opts.host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256hex(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${opts.secretAccessKey}`, day), opts.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return `https://${opts.host}${path}?${qs}&X-Amz-Signature=${signature}`;
}

export function r2Config() {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE } = process.env;
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET || !R2_PUBLIC_BASE) return null;
  return { account: R2_ACCOUNT_ID, accessKeyId: R2_ACCESS_KEY_ID, secret: R2_SECRET_ACCESS_KEY, bucket: R2_BUCKET,
           publicBase: R2_PUBLIC_BASE.replace(/\/$/, "") };
}

/** A 10-minute URL that lets the browser PUT exactly one object at `key`. */
export function presignedPut(key: string) {
  const c = r2Config();
  if (!c) return null;
  return presign({
    method: "PUT", host: `${c.account}.r2.cloudflarestorage.com`, path: `/${c.bucket}/${key}`, region: "auto",
    accessKeyId: c.accessKeyId, secretAccessKey: c.secret, expires: 600,
  });
}

/** Delete one object (server side). R2 answers 204 even if it was already gone. */
export async function deleteObject(key: string): Promise<boolean> {
  const c = r2Config();
  if (!c) return false;
  const url = presign({
    method: "DELETE", host: `${c.account}.r2.cloudflarestorage.com`, path: `/${c.bucket}/${key}`, region: "auto",
    accessKeyId: c.accessKeyId, secretAccessKey: c.secret, expires: 60,
  });
  const res = await fetch(url, { method: "DELETE" });
  return res.ok;
}

export function publicUrl(key: string) {
  const c = r2Config();
  return c ? `${c.publicBase}/${key.split("/").map(enc).join("/")}` : null;
}

/** Every key under `prefix` (ListObjectsV2, server side). */
export async function listKeys(prefix: string): Promise<string[] | null> {
  const c = r2Config();
  if (!c) return null;
  const keys: string[] = [];
  let token = "";
  for (;;) {
    const query: Record<string, string> = { "list-type": "2", prefix, ...(token ? { "continuation-token": token } : {}) };
    const url = presign({
      method: "GET", host: `${c.account}.r2.cloudflarestorage.com`, path: `/${c.bucket}`, region: "auto",
      accessKeyId: c.accessKeyId, secretAccessKey: c.secret, expires: 60, query,
    });
    const res = await fetch(url);
    if (!res.ok) return null;
    const xml = await res.text();
    const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
    keys.push(...Array.from(xml.matchAll(/<Key>([^<]*)<\/Key>/g), (m) => unxml(m[1])));
    const next = xml.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/);
    if (!/<IsTruncated>true<\/IsTruncated>/.test(xml) || !next) return keys;
    token = unxml(next[1]);
  }
}

/** Copy one object to a new key: read it through the public URL, PUT it with a presigned URL (server side). */
export async function copyObject(from: string, to: string): Promise<boolean> {
  const c = r2Config();
  const src = publicUrl(from);
  if (!c || !src) return false;
  const got = await fetch(src);
  if (!got.ok) return false;
  const url = presign({
    method: "PUT", host: `${c.account}.r2.cloudflarestorage.com`, path: `/${c.bucket}/${to}`, region: "auto",
    accessKeyId: c.accessKeyId, secretAccessKey: c.secret, expires: 300,
  });
  const put = await fetch(url, { method: "PUT", body: await got.arrayBuffer(),
                                 headers: { "Content-Type": got.headers.get("content-type") ?? "application/octet-stream" } });
  return put.ok;
}
