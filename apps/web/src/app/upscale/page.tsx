import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { UpscaleDropzone } from "@/components/UpscaleDropzone";

export const metadata: Metadata = {
  title: "AI Image Upscaler — 2× / 4× | Quick Fix",
  description:
    "Upscale photos up to 4× with the open-source Swin2SR model. No sign-up for the first 20 images a month.",
  openGraph: {
    title: "AI Image Upscaler — 2× / 4× | Quick Fix",
    description: "Upscale photos up to 4× with open-source AI.",
  },
};

export default function UpscalePage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-20 pb-12 text-center">
          <h1 className="text-5xl font-semibold tracking-tight md:text-6xl">
            Upscale images
            <br />
            2× or 4×.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-[var(--color-muted)]">
            Drop a low-resolution photo — get a sharp, high-res PNG. Powered by Swin2SR.
          </p>
        </section>

        <section id="tool" className="mx-auto max-w-2xl pb-20">
          <UpscaleDropzone />
          <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
            Images are processed on our servers and deleted within 1 hour.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 pb-20 md:grid-cols-3">
          <Feature
            title="Swin2SR open-source model"
            body="The same architecture family as Swin Transformer, fine-tuned for real-world photos."
          />
          <Feature
            title="2× or 4×"
            body="2× is fast (~60s on CPU). 4× uses the realistic-photo BSRGAN-tuned variant for detail."
          />
          <Feature
            title="Private"
            body="Your images are deleted within an hour. We don't train on your data."
          />
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
