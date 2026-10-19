import { randomBytes } from "crypto";

export const newToken = () => randomBytes(18).toString("base64url");

// Plain check, not RFC-complete: one @, a dot in the domain, no spaces, sane length.
export function cleanEmail(v: unknown): string | null {
  const e = String(v ?? "").trim().toLowerCase();
  return e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : null;
}
