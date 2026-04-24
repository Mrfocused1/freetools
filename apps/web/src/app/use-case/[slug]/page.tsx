import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { UploadDropzone } from "@/components/UploadDropzone";
import { UpscaleDropzone } from "@/components/UpscaleDropzone";
import { USE_CASES, type UseCase } from "@/lib/use-cases";

type Params = { slug: string };

export async function generateStaticParams() {
  return USE_CASES.map((u) => ({ slug: u.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;
  const uc = USE_CASES.find((u) => u.slug === slug);
  if (!uc) return { title: "Not found" };
  return {
    title: uc.title,
    description: uc.intro,
    keywords: uc.keywords.join(", "),
    openGraph: {
      title: uc.title,
      description: uc.intro,
      type: "website",
    },
  };
}

export default async function UseCasePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;
  const uc = USE_CASES.find((u) => u.slug === slug);
  if (!uc) notFound();

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-4xl px-6 py-16">
        <header className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">{uc.h1}</h1>
          <p className="mt-3 text-lg text-[var(--color-muted)]">{uc.subhead}</p>
          <p className="mx-auto mt-6 max-w-2xl text-base text-[var(--color-muted)]">{uc.intro}</p>
        </header>

        {/* Inline demo — branch on tool so upscale use-cases embed the upscaler */}
        <section id="demo" className="mt-10">
          {uc.tool === "upscale" ? <UpscaleDropzone /> : <UploadDropzone />}
        </section>

        <section className="mt-16 grid grid-cols-1 gap-8 md:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Why Quick Fix</h2>
            <ul className="mt-4 space-y-2 text-sm text-[var(--color-muted)]">
              {uc.bullets.map((b, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-2xl font-semibold">How it works</h2>
            <ol className="mt-4 space-y-2 text-sm text-[var(--color-muted)]">
              {uc.howTo.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--color-border)] text-[10px]">
                    {i + 1}
                  </span>
                  <span>{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {uc.faqs.length > 0 && (
          <section className="mt-16">
            <h2 className="text-2xl font-semibold">Frequently asked</h2>
            <div className="mt-4 divide-y divide-[var(--color-border)] rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {uc.faqs.map((f, i) => (
                <details key={i} className="group p-5">
                  <summary className="cursor-pointer list-none text-sm font-medium">
                    {f.q}
                  </summary>
                  <p className="mt-2 text-sm text-[var(--color-muted)]">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section className="mt-16 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center">
          <h2 className="text-xl font-semibold">Try it free</h2>
          <p className="mt-2 text-sm text-[var(--color-muted)]">
            20 free images a month, no sign-up needed.
          </p>
          <Link
            href="/#demo"
            className="mt-4 inline-block rounded-md bg-[var(--color-accent)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--color-accent-hover)]"
          >
            Start now
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
