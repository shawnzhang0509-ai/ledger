import { createHash, createHmac, timingSafeEqual } from "crypto";
import { NextRequest } from "next/server";
import { getKvClient } from "@/lib/kv";

export const SESSION_COOKIE = "session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// Login attempts: 5 wrong passwords per IP per 15 minutes, 30 per hour in total.
const IP_LIMIT = 5;
const IP_WINDOW_S = 15 * 60;
const GLOBAL_LIMIT = 30;
const GLOBAL_WINDOW_S = 60 * 60;

function sha256(text: string): Buffer {
  return createHash("sha256").update(text).digest();
}

// The signing key is derived from APP_PASSWORD, so changing it logs every device (admin and viewer) out.
function signingKey(): Buffer | null {
  const password = process.env.APP_PASSWORD;
  return password ? sha256(`ledger-session:${password}`) : null;
}

function sign(payload: string, key: Buffer): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export type Role = "admin" | "viewer";

function same(a: string, b: string): boolean {
  return timingSafeEqual(sha256(a), sha256(b));
}

/** APP_PASSWORD = admin (orders + ops). VIEWER_PASSWORD = colleagues (ops dashboard only). */
export function passwordRole(input: unknown): Role | null {
  const admin = process.env.APP_PASSWORD;
  const viewer = process.env.VIEWER_PASSWORD;
  if (typeof input !== "string" || !admin) return null;
  if (same(input, admin)) return "admin";
  if (viewer && viewer !== admin && same(input, viewer)) return "viewer";
  return null;
}

/** A signed, expiring token naming the role. The cookie never holds a password. */
export function createSessionToken(role: Role, exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload = `${exp}:${role}`;
  return `${payload}.${sign(payload, key)}`;
}

// Links with a view pass (owner 2026-10-27: "这个链接有没有可能做成直接进的"): the bots' card links carry
// `exp:viewer.<mac>`, signed by the driftae-ops server with a key derived from METRICS_PUSH_TOKEN (it already holds it),
// at most LINK_MAX_DAYS ahead. Opening one sets a separate viewer cookie: never admin, never replaces a password login.
export const LINK_COOKIE = "view_link";
export const LINK_MAX_DAYS = 8;

function linkKey(): Buffer | null {
  const token = process.env.METRICS_PUSH_TOKEN;
  return token ? sha256(`view-link:${token}`) : null;
}

/** The pass's expiry (unix seconds) when it is genuine, unexpired and for a viewer; otherwise null. */
export function viewLinkExpiry(t: string | null): number | null {
  const key = linkKey();
  if (!key || !t) return null;
  const [payload, mac] = t.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [exp, role] = payload.split(":");
  const now = Date.now() / 1000;
  if (role !== "viewer" || !(Number(exp) > now) || Number(exp) > now + LINK_MAX_DAYS * 86400) return null;
  return Number(exp);
}

function cookieRole(key: Buffer, token: string | undefined): Role | null {
  if (!token) return null;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return null;
  const expected = Buffer.from(sign(payload, key));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [exp, role] = payload.split(":");
  if (!(Number(exp) > Date.now() / 1000)) return null;
  return role === "admin" || role === "viewer" ? role : null;
}

export function sessionRole(request: NextRequest): Role | null {
  const key = signingKey();
  if (!key) return null;
  return cookieRole(key, request.cookies.get(SESSION_COOKIE)?.value)
    ?? (cookieRole(key, request.cookies.get(LINK_COOKIE)?.value) === "viewer" ? "viewer" : null);
}

/** Orders (customer names, costs) are admin-only. */
export function isAuthenticated(request: NextRequest): boolean {
  return sessionRole(request) === "admin";
}

export function pushTokenMatches(header: string | null): boolean {
  const token = process.env.METRICS_PUSH_TOKEN;
  if (!token || !header?.startsWith("Bearer ")) return false;
  return same(header.slice(7), token);
}

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** True while this IP (or everyone together) has too many recent wrong passwords. */
export async function loginBlocked(request: NextRequest): Promise<boolean> {
  const kv = getKvClient();
  const [ip, all] = await Promise.all([
    kv.get<number>(`auth:fail:${clientIp(request)}`),
    kv.get<number>("auth:fail:all"),
  ]);
  return (ip ?? 0) >= IP_LIMIT || (all ?? 0) >= GLOBAL_LIMIT;
}

export async function recordFailedLogin(request: NextRequest): Promise<void> {
  const kv = getKvClient();
  const ipKey = `auth:fail:${clientIp(request)}`;
  if ((await kv.incr(ipKey)) === 1) await kv.expire(ipKey, IP_WINDOW_S);
  if ((await kv.incr("auth:fail:all")) === 1) await kv.expire("auth:fail:all", GLOBAL_WINDOW_S);
}
