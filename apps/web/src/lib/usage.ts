import { supabaseAdmin } from "./supabase/server";
import { TIERS, type Tier } from "./tiers";

// Count images the user/anon has successfully processed this calendar month.
export async function getMonthUsage(params: {
  userId?: string;
  anonFingerprint?: string;
}): Promise<number> {
  const db = supabaseAdmin();
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);

  let q = db
    .from("usage_events")
    .select("id", { count: "exact", head: true })
    .eq("event_type", "job_succeeded")
    .gte("created_at", start.toISOString());

  if (params.userId) q = q.eq("user_id", params.userId);
  else if (params.anonFingerprint) q = q.eq("anon_fingerprint", params.anonFingerprint);
  else return 0;

  const { count, error } = await q;
  if (error) {
    console.error("[usage] getMonthUsage", error);
    return 0;
  }
  return count ?? 0;
}

export async function canSubmit(params: {
  userId?: string;
  anonFingerprint?: string;
  tier: Tier;
  creditBalance?: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const cfg = TIERS[params.tier];
  const used = await getMonthUsage({
    userId: params.userId,
    anonFingerprint: params.anonFingerprint,
  });

  if (used < cfg.monthlyImages) return { ok: true };

  if ((params.creditBalance ?? 0) > 0) return { ok: true };

  return {
    ok: false,
    reason:
      params.tier === "free"
        ? "You've used all 20 free images this month. Upgrade to Pro for 500/month or buy credits."
        : "You've hit your monthly limit. Buy a credit pack to continue.",
  };
}
