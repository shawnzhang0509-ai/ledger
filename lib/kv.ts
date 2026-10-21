import { createClient } from "@vercel/kv";

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  return { url, token };
}

export function getKvClient() {
  const { url, token } = getKvConfig();

  if (!url || !token) {
    throw new Error("KV_NOT_CONFIGURED");
  }

  // @vercel/kv defaults to fetch cache "default", so Next could serve a read from its data cache and pages
  // showed values from before a write (2026-10-21: books still "缺汇率" after the rate was filled).
  return createClient({ url, token, cache: "no-store" });
}
