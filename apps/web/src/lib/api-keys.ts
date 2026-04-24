import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "./supabase/server";
import type { Tier } from "./tiers";

export type ApiKeyRow = {
  id: string;
  user_id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

export function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export function generateApiKey(): { full: string; prefix: string; hash: string } {
  const body = randomBytes(24).toString("base64url");
  const full = `qf_live_${body}`;
  return { full, prefix: full.slice(0, 12), hash: sha256(full) };
}

// Resolves a bearer token to a user + profile tier. Returns null if unauthorised.
export async function authenticateApiKey(raw: string | null): Promise<
  | { userId: string; tier: Tier; keyId: string }
  | null
> {
  if (!raw) return null;
  const token = raw.replace(/^Bearer\s+/i, "").trim();
  if (!token.startsWith("qf_live_")) return null;

  const admin = supabaseAdmin();
  const hash = sha256(token);
  const { data: row } = await admin
    .from("api_keys")
    .select("id, user_id, revoked_at")
    .eq("key_hash", hash)
    .single();
  if (!row || row.revoked_at) return null;

  const { data: profile } = await admin
    .from("profiles")
    .select("tier")
    .eq("id", row.user_id)
    .single();

  const tier = (profile?.tier as Tier) ?? "free";

  // Fire-and-forget: update last_used_at.
  admin
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", row.id)
    .then(() => undefined, () => undefined);

  return { userId: row.user_id, tier, keyId: row.id };
}
