import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { FontIdentifyUI } from "@/components/FontIdentifyUI";

export const metadata: Metadata = {
  title: "Font Identifier & Generator — find or clone any font | Quick Fix",
  description:
    "Upload a screenshot or photo with text. We match it to 5,000+ free fonts — or generate a custom installable TTF from the glyphs in your image.",
  openGraph: {
    title: "Font Identifier & Generator | Quick Fix",
    description:
      "Identify any font from an image, or generate your own custom TTF file. Free early access.",
  },
};

export const dynamic = "force-dynamic";

export default function FontPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Font Identifier &amp; Generator</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)]">
            Upload an image with text. We&apos;ll match it to 5,000+ free fonts — or generate your
            own custom TTF file straight from the glyphs in your image.
          </p>
        </header>
        <FontIdentifyUI />
      </main>
      <Footer />
    </>
  );
}
