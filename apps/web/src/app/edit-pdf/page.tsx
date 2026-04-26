import type { Metadata } from "next";
import { Navbar } from "@/components/Navbar";
import { Footer } from "@/components/Footer";
import { PdfEditor } from "@/components/PdfEditor";

export const metadata: Metadata = {
  title: "Edit PDF Text Online — Free | Quick Fix",
  description:
    "Edit text in any PDF directly in your browser. Upload, click any text, type your change, download. No watermark. Powered by open-source.",
  openGraph: {
    title: "Edit PDF Text Online — Free | Quick Fix",
    description: "Click any text in your PDF and rewrite it. Free, no signup.",
  },
};

export default function EditPdfPage() {
  return (
    <>
      <Navbar />
      <main className="mx-auto max-w-6xl px-6">
        <section className="pt-20 pb-10 text-center">
          <h1 className="text-5xl font-semibold tracking-tight md:text-6xl">
            Edit text in any PDF.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-lg text-[var(--color-muted)]">
            Drop a PDF — click any text — type your change — download. Free for the first
            5 PDFs a month.
          </p>
        </section>

        <section className="pb-20">
          <PdfEditor />
          <p className="mt-4 text-center text-xs text-[var(--color-muted)]">
            Born-digital PDFs only (PDFs that already contain a text layer). For scanned
            documents, OCR support is coming next. Files are deleted within 1 hour.
          </p>
        </section>

        <section className="grid grid-cols-1 gap-6 pb-20 md:grid-cols-3">
          <Feature
            title="Inline editing"
            body="Click directly on any text in your PDF and type — we replace it in place, preserving your layout."
          />
          <Feature
            title="No watermark"
            body="Your edited PDF downloads clean, no Quick Fix branding."
          />
          <Feature
            title="100% private"
            body="Files are processed on our servers and deleted within an hour. We don't train on your data."
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
