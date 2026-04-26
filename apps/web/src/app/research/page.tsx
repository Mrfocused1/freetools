import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ResearchUI } from "@/components/ResearchUI";

export const metadata: Metadata = {
  title: "AI Research — ask anything, with citations | Quick Fix",
  description:
    "Free AI research assistant powered by Gemma 4. Ask any question — it searches the web and answers with citations.",
  openGraph: {
    title: "AI Research — ask anything | Quick Fix",
    description: "Free AI research assistant. Ask any question, get a cited answer.",
  },
};

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6 text-center">
          <h1 className="text-4xl font-semibold tracking-tight">AI Research</h1>
          <p className="mx-auto mt-2 max-w-xl text-sm text-[var(--color-muted)]">
            Ask anything. We search the web and read pages, then give you an answer
            with citations. Free — no signup needed.
          </p>
        </header>
        <ResearchUI />
      </main>
      <Footer />
    </>
  );
}
