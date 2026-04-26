import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { ResearchUI } from "@/components/ResearchUI";
import { supabaseServer } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Research — Gemma 4 + web browsing | Quick Fix",
  description: "Ask anything. Gemma 4 searches the web and answers with citations.",
};

export const dynamic = "force-dynamic";

export default async function ResearchPage() {
  const sb = await supabaseServer();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) redirect("/login");

  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-6">
          <h1 className="text-3xl font-semibold tracking-tight">Research</h1>
          <p className="mt-1 text-sm text-[var(--color-muted)]">
            Ask anything. Gemma 4 searches the web (via Searxng + Crawl4AI on this server)
            and answers with citations.
          </p>
        </header>
        <ResearchUI />
      </main>
      <Footer />
    </>
  );
}
