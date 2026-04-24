import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/api-keys";
import { TIERS, type Tier } from "@/lib/tiers";

export async function GET() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const admin = supabaseAdmin();
  const { data } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return NextResponse.json({ keys: data ?? [] });
}

const Create = z.object({ name: z.string().min(1).max(60) });

export async function POST(req: NextRequest) {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const parsed = Create.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();
  const tier = (profile?.tier as Tier) ?? "free";
  if (TIERS[tier].apiAccess === "none") {
    return NextResponse.json(
      { error: "API access requires Pro or Business" },
      { status: 403 }
    );
  }

  const { full, prefix, hash } = generateApiKey();
  const { error } = await admin.from("api_keys").insert({
    user_id: user.id,
    name: parsed.data.name,
    key_prefix: prefix,
    key_hash: hash,
  });
  if (error) {
    console.error("[api-keys] insert", error);
    return NextResponse.json({ error: "Could not create key" }, { status: 500 });
  }

  // Return the full key ONCE. It cannot be retrieved again.
  return NextResponse.json({ key: full, prefix });
}
