import { redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BatchUpload } from "@/components/BatchUpload";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { TIERS, type Tier } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function BatchPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool: toolParam } = await searchParams;

  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect("/login?next=/dashboard/batch");

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("tier")
    .eq("id", user.id)
    .single();
  const tier = (profile?.tier as Tier) ?? "free";
  const cfg = TIERS[tier];

  // Pro or Business only.
  if (tier === "free") {
    return (
      <>
        <Navbar />
        <main className="mx-auto max-w-3xl px-6 py-20 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Batch upload</h1>
          <p className="mt-3 text-[var(--color-muted)]">
            Process 20 images at a time on Pro, 100 at a time on Business.
          </p>
          <div className="mt-8 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8">
            <p className="text-lg font-medium">Available on Pro and Business plans</p>
            <p className="mt-2 text-sm text-[var(--color-muted)]">
              You're on the Free plan right now. Upgrade to unlock batch processing, higher-resolution input, priority queue, and more.
            </p>
            <Link
              href="/pricing"
              className="mt-6 inline-block rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
            >
              See Pro plans
            </Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const tool = toolParam === "upscale" ? "upscale" : "bg-remove";

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Batch upload</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            {cfg.name} plan — up to {cfg.batchSize} files at a time. Files process sequentially.
          </p>
        </header>

        <nav className="mt-6 flex gap-2">
          <Link
            href="/dashboard/batch?tool=bg-remove"
            className={`rounded-md border px-4 py-2 text-sm ${
              tool === "bg-remove"
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-fg)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            Background removal
          </Link>
          <Link
            href="/dashboard/batch?tool=upscale"
            className={`rounded-md border px-4 py-2 text-sm ${
              tool === "upscale"
                ? "border-[var(--color-accent)] bg-[var(--color-accent)]/10 text-[var(--color-fg)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            }`}
          >
            Upscaling
          </Link>
        </nav>

        <section className="mt-6">
          <BatchUpload
            tool={tool}
            maxFiles={cfg.batchSize}
            extraOptions={
              tool === "upscale" ? { scale: 2 } : { hairMode: false, featherRadius: 0.8 }
            }
          />
        </section>
      </main>
      <Footer />
    </>
  );
}
