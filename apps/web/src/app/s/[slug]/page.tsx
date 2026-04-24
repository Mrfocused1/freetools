import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { BeforeAfterSlider } from "@/components/BeforeAfterSlider";
import { supabaseAdmin } from "@/lib/supabase/server";

type Params = { slug: string };

async function loadShare(slug: string) {
  const admin = supabaseAdmin();
  const { data: share } = await admin
    .from("shares")
    .select("slug, job_id")
    .eq("slug", slug)
    .single();
  if (!share) return null;

  const input = `shared/${slug}/before.jpg`;
  const output = `shared/${slug}/after.png`;

  // Try the common input extensions — we store with the original ext.
  const candidates = ["jpg", "jpeg", "png", "webp"].map(
    (ext) => `shared/${slug}/before.${ext}`
  );
  let beforePath: string | null = null;
  for (const c of candidates) {
    const { data } = await admin.storage
      .from("images")
      .list(`shared/${slug}`, { search: `before.${c.split(".").pop()}` });
    if (data?.length) {
      beforePath = c;
      break;
    }
  }

  // Signed URLs good for 1 hour.
  const [{ data: beforeSigned }, { data: afterSigned }] = await Promise.all([
    admin.storage
      .from("images")
      .createSignedUrl(beforePath ?? input, 60 * 60),
    admin.storage.from("images").createSignedUrl(output, 60 * 60),
  ]);

  if (!afterSigned) return null;

  return {
    slug,
    beforeUrl: beforeSigned?.signedUrl ?? null,
    afterUrl: afterSigned.signedUrl,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const og = `${base}/s/${slug}/opengraph-image`;
  return {
    title: "Before & after — Quick Fix",
    description: "See this background removed with Quick Fix.",
    openGraph: {
      title: "Before & after — Quick Fix",
      description: "See this background removed with Quick Fix.",
      url: `${base}/s/${slug}`,
      images: [{ url: og, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Before & after — Quick Fix",
      description: "See this background removed with Quick Fix.",
      images: [og],
    },
  };
}

export default async function SharePage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const share = await loadShare(slug);
  if (!share) notFound();

  // Bump view counter (fire-and-forget).
  supabaseAdmin().rpc("increment_share_view", { p_slug: slug }).then(
    () => undefined,
    () => undefined
  );

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-12">
        <header className="mb-6 text-center">
          <h1 className="text-3xl font-semibold tracking-tight">Before & after</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            Drag the divider to compare. Background removed by{" "}
            <Link href="/" className="underline decoration-dotted hover:text-[var(--color-fg)]">
              Quick Fix
            </Link>
            .
          </p>
        </header>

        <div
          className="overflow-hidden rounded-2xl border border-[var(--color-border)]"
          style={{
            backgroundImage:
              "linear-gradient(45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(-45deg, var(--color-checker-a) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, var(--color-checker-a) 75%), linear-gradient(-45deg, transparent 75%, var(--color-checker-a) 75%)",
            backgroundSize: "16px 16px",
            backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
          }}
        >
          {share.beforeUrl ? (
            <BeforeAfterSlider beforeUrl={share.beforeUrl} afterUrl={share.afterUrl} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={share.afterUrl}
              alt="Result"
              className="mx-auto block h-auto w-full"
            />
          )}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/"
            className="rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Remove a background of your own
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
