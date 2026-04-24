import { redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ApiKeysManager } from "@/components/ApiKeysManager";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { TIERS, type Tier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function ApiKeysPage() {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/api-keys");

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();
  const tier = (profile?.tier as Tier) ?? "free";

  if (TIERS[tier].apiAccess === "none") {
    return (
      <>
        <Navbar />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">API access</h1>
          <p className="mt-3 text-[var(--color-muted)]">
            Upgrade to Pro for basic API access (60 rpm) or Business for full access (600 rpm + webhooks).
          </p>
          <Link
            href="/pricing"
            className="mt-8 inline-block rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            See plans
          </Link>
        </main>
        <Footer />
      </>
    );
  }

  const { data: keys } = await admin
    .from("api_keys")
    .select("id, name, key_prefix, created_at, last_used_at, revoked_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">API keys</h1>
            <p className="mt-1 text-sm text-[var(--color-muted)]">
              {TIERS[tier].apiAccess === "full"
                ? "Business plan — 600 requests/minute."
                : "Pro plan — 60 requests/minute."}
              {" "}
              <Link href="/docs/api" className="underline decoration-dotted">
                Read the API docs
              </Link>
              .
            </p>
          </div>
        </header>

        <section className="mt-8">
          <ApiKeysManager initial={(keys ?? []).map((k) => ({ ...k, last_used_at: k.last_used_at ?? null, revoked_at: k.revoked_at ?? null }))} />
        </section>
      </main>
      <Footer />
    </>
  );
}
