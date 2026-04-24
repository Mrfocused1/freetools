import { redirect } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BuyCreditsButton } from "@/components/BuyCreditsButton";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { getMonthUsage } from "@/lib/usage";
import { TIERS } from "@/lib/tiers";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  const admin = supabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("tier, credit_balance, subscription_current_period_end")
    .eq("id", user.id)
    .single();

  const tier = (profile?.tier ?? "free") as keyof typeof TIERS;
  const cfg = TIERS[tier];
  const used = await getMonthUsage({ userId: user.id });
  const remaining = Math.max(0, cfg.monthlyImages - used);

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-5xl px-6 py-12">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
            <p className="mt-1 text-sm text-[var(--color-muted)]">{user.email}</p>
          </div>
          <form action="/api/billing/portal" method="post">
            <button className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm">
              Manage billing
            </button>
          </form>
        </header>

        <section className="mt-10 grid grid-cols-1 gap-6 md:grid-cols-3">
          <Card label="Plan" value={cfg.name} hint={`${cfg.monthlyImages.toLocaleString()}/mo`} />
          <Card label="Used this month" value={used.toLocaleString()} hint={`${remaining.toLocaleString()} left`} />
          <Card label="Credits" value={(profile?.credit_balance ?? 0).toLocaleString()} hint="Never expire" />
        </section>

        {/* Quick actions */}
        <section className="mt-10 flex flex-wrap gap-3">
          <Link
            href="/"
            className="rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Remove a background
          </Link>
          <Link
            href="/upscale"
            className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm hover:border-[var(--color-accent)]"
          >
            Upscale an image
          </Link>
          <Link
            href="/dashboard/batch"
            className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm hover:border-[var(--color-accent)]"
          >
            Batch upload {tier === "free" ? "🔒" : ""}
          </Link>
          <Link
            href="/dashboard/api-keys"
            className="rounded-md border border-[var(--color-border)] px-5 py-2.5 text-sm hover:border-[var(--color-accent)]"
          >
            API keys {tier === "free" ? "🔒" : ""}
          </Link>
        </section>

        {/* Credit packs */}
        <section className="mt-12 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Top up credits</h2>
              <p className="mt-1 text-sm text-[var(--color-muted)]">
                Credits stack on top of your plan and never expire. Each credit = one image processed.
              </p>
            </div>
            <span className="whitespace-nowrap rounded-full border border-[var(--color-border)] px-3 py-1 text-xs text-[var(--color-muted)]">
              Balance: {(profile?.credit_balance ?? 0).toLocaleString()}
            </span>
          </div>
          <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
              <p className="text-sm font-medium">Starter pack</p>
              <p className="text-xs text-[var(--color-muted)]">100 credits · $0.05 each</p>
              <div className="mt-3">
                <BuyCreditsButton pack="small" label="Buy 100 credits" price="$5" />
              </div>
            </div>
            <div className="rounded-xl border border-[var(--color-accent)] bg-[var(--color-accent)]/5 p-4">
              <p className="text-sm font-medium">
                Volume pack <span className="ml-1 rounded-full bg-[var(--color-accent)]/20 px-2 py-0.5 text-[10px] text-[var(--color-accent)]">SAVE 20%</span>
              </p>
              <p className="text-xs text-[var(--color-muted)]">1,000 credits · $0.04 each</p>
              <div className="mt-3">
                <BuyCreditsButton pack="large" label="Buy 1,000 credits" price="$40" variant="primary" />
              </div>
            </div>
          </div>
        </section>

        {/* Recent jobs */}
        <RecentJobs userId={user.id} />
      </main>
      <Footer />
    </>
  );
}

async function RecentJobs({ userId }: { userId: string }) {
  const admin = supabaseAdmin();
  const { data: jobs } = await admin
    .from("jobs")
    .select("id, tool, status, created_at, model")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!jobs || jobs.length === 0) {
    return null;
  }

  return (
    <section className="mt-12">
      <h2 className="text-xl font-semibold">Recent activity</h2>
      <div className="mt-4 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--color-bg)]/40 text-xs text-[var(--color-muted)]">
            <tr>
              <th className="px-4 py-2 text-left">Tool</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Model</th>
              <th className="px-4 py-2 text-right">When</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} className="border-t border-[var(--color-border)]">
                <td className="px-4 py-2">{j.tool === "upscale" ? "Upscale" : "Remove bg"}</td>
                <td className="px-4 py-2">
                  <StatusPill status={j.status as string} />
                </td>
                <td className="px-4 py-2 text-[var(--color-muted)]">{j.model ?? "—"}</td>
                <td className="px-4 py-2 text-right text-[var(--color-muted)]">
                  {relTime(j.created_at as string)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    succeeded: "bg-emerald-500/15 text-emerald-500",
    processing: "bg-amber-500/15 text-amber-500",
    queued: "bg-sky-500/15 text-sky-500",
    failed: "bg-red-500/15 text-red-500",
  };
  const cls = map[status] ?? "bg-[var(--color-border)] text-[var(--color-muted)]";
  return <span className={`rounded-full px-2 py-0.5 text-xs ${cls}`}>{status}</span>;
}

function relTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function Card({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <p className="text-sm text-[var(--color-muted)]">{label}</p>
      <p className="mt-2 text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-[var(--color-muted)]">{hint}</p>
    </div>
  );
}
