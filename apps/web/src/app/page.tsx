import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { UploadDropzone } from "@/components/UploadDropzone";
import { TIERS } from "@/lib/tiers";
import Link from "next/link";

export default function HomePage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-6">
        {/* Hero */}
        <section className="pt-20 pb-12 text-center">
          <h1 className="text-5xl font-semibold tracking-tight md:text-6xl">
            Remove image backgrounds
            <br />
            in seconds.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-[var(--color-muted)]">
            Drop a photo — get a clean transparent PNG. No signup for the first 20 images this month.
          </p>
        </section>

        {/* Upload */}
        <section id="tools" className="mx-auto max-w-2xl pb-20">
          <UploadDropzone />
          <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
            Images are processed on our servers and deleted within 1 hour.
          </p>
        </section>

        {/* Feature strip */}
        <section className="grid grid-cols-1 gap-6 pb-20 md:grid-cols-3">
          <Feature
            title="BiRefNet SOTA model"
            body="Powered by the same architecture that beats Photoshop and Remove.bg on edge quality."
          />
          <Feature
            title="Fast on GPU"
            body="Sub-second inference on dedicated NVIDIA hardware. No waiting in a long free-tier queue."
          />
          <Feature
            title="Private"
            body="Your images are deleted after processing. We don't train on your data."
          />
        </section>

        {/* Pricing preview */}
        <section className="pb-20">
          <h2 className="mb-8 text-center text-3xl font-semibold tracking-tight">Simple pricing</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {(Object.keys(TIERS) as Array<keyof typeof TIERS>).map((key) => {
              const t = TIERS[key];
              return (
                <div
                  key={key}
                  className={`rounded-2xl border p-6 ${
                    key === "pro"
                      ? "border-[var(--color-accent)] bg-[var(--color-accent)]/5"
                      : "border-[var(--color-border)] bg-[var(--color-surface)]"
                  }`}
                >
                  <p className="text-sm text-[var(--color-muted)]">{t.name}</p>
                  <p className="mt-2 text-3xl font-semibold">
                    ${t.monthlyPriceUsd}
                    <span className="text-sm font-normal text-[var(--color-muted)]">/mo</span>
                  </p>
                  <ul className="mt-4 space-y-2 text-sm text-[var(--color-muted)]">
                    <li>{t.monthlyImages.toLocaleString()} images/month</li>
                    <li>Up to {t.maxInputDimension}×{t.maxInputDimension} input</li>
                    <li>{t.maxOutputDimension === 0 ? "Full" : `${t.maxOutputDimension}px`} output</li>
                    <li>Batch of {t.batchSize}</li>
                    <li>
                      {t.apiAccess === "none"
                        ? "Web only"
                        : t.apiAccess === "basic"
                          ? "Basic API"
                          : "Full API + webhooks"}
                    </li>
                  </ul>
                  <Link
                    href="/pricing"
                    className={`mt-6 block rounded-md px-4 py-2 text-center text-sm font-medium ${
                      key === "pro"
                        ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
                        : "border border-[var(--color-border)]"
                    }`}
                  >
                    {key === "free" ? "Start free" : `Choose ${t.name}`}
                  </Link>
                </div>
              );
            })}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6">
      <h3 className="font-medium">{title}</h3>
      <p className="mt-2 text-sm text-[var(--color-muted)]">{body}</p>
    </div>
  );
}
