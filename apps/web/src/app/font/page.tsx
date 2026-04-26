import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { FontIdentifyUI } from "@/components/FontIdentifyUI";

export const metadata: Metadata = {
  title: "Font Identifier — find any font from an image | Quick Fix",
  description:
    "Upload a screenshot or photo with text. We match it to 5,000+ free fonts and show you where to download.",
  openGraph: {
    title: "Font Identifier — find any font | Quick Fix",
    description: "Upload an image with text. We identify the font and give you a download link.",
  },
};

export const dynamic = "force-dynamic";

export default function FontPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">Font Identifier</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)]">
            Upload an image with text. We&apos;ll match it to 5,000+ free fonts and show you where
            to download.
          </p>
        </header>
        <FontIdentifyUI />
      </main>
      <Footer />
    </>
  );
}
