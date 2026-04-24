import { createHash } from "node:crypto";

// Stable anonymous id: SHA-256(ip + user-agent + daily-salt)
// Daily salt rotates to limit cross-day tracking.
export function anonFingerprint(ip: string, userAgent: string | null): string {
  const day = new Date().toISOString().slice(0, 10);
  const input = `${ip}|${userAgent ?? ""}|${day}|${process.env.ANON_SALT ?? "quickfix"}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}
