import { redis } from "./redis";

// Sliding-window rate limit using a Redis sorted set.
// Key: `rl:<scope>`, members: unique request ids, scores: unix ms timestamps.
export async function rateLimit(opts: {
  scope: string;
  limit: number;
  windowMs: number;
}): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
  const r = redis();
  const key = `rl:${opts.scope}`;
  const now = Date.now();
  const windowStart = now - opts.windowMs;
  const member = `${now}:${Math.random().toString(36).slice(2, 8)}`;

  const pipeline = r.multi();
  pipeline.zremrangebyscore(key, 0, windowStart);
  pipeline.zadd(key, now, member);
  pipeline.zcard(key);
  pipeline.pexpire(key, opts.windowMs);
  const res = await pipeline.exec();
  if (!res) {
    return { allowed: true, remaining: opts.limit, resetMs: opts.windowMs };
  }
  const count = (res[2]?.[1] as number) ?? 0;

  return {
    allowed: count <= opts.limit,
    remaining: Math.max(0, opts.limit - count),
    resetMs: opts.windowMs,
  };
}

// IP extractor — works with Vercel, Caddy, bare Node.
export function getClientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "0.0.0.0";
}
