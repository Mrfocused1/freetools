import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ImageEditUI } from "@/components/ImageEditUI";

export const metadata: Metadata = {
  title: "AI Image Editor — Edit any photo with a prompt | Quick Fix",
  description:
    "Upload a photo, describe the change in plain English, get a polished result. Powered by FLUX.1 Kontext. Free for 3 edits per day.",
  openGraph: {
    title: "AI Image Editor — Edit any photo with a prompt | Quick Fix",
    description:
      "Upload a photo, describe the change in plain English, get a polished result. Free — no signup needed.",
  },
};

export const dynamic = "force-dynamic";

export default function EditImagePage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">
            Edit any image with words.
          </h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)]">
            Upload a photo, describe the change in plain English, get a polished
            result. Powered by FLUX.1 Kontext. Free for 3 edits per day.
          </p>
        </header>
        <ImageEditUI />
        <p className="mt-6 text-center text-xs text-[var(--color-muted)]">
          Images are processed by fal.ai&apos;s API. Your edits are not used for training.
        </p>
      </main>
      <Footer />
    </>
  );
}
