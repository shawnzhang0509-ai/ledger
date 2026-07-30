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

  return createClient({ url, token });
}
