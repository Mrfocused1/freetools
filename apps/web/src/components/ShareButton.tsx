"use client";

import { useState } from "react";
import { useToast } from "./Toast";

export function ShareButton({ jobId }: { jobId: string }) {
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  async function onClick() {
    try {
      setLoading(true);
      const res = await fetch(`/api/jobs/${jobId}/share`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Share failed" }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const { url } = await res.json();
      try {
        await navigator.clipboard.writeText(url);
        toast.show("Share link copied");
      } catch {
        toast.show(`Share URL: ${url}`);
      }
    } catch (e) {
      toast.show(e instanceof Error ? e.message : "Share failed", { tone: "error" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm disabled:opacity-50"
      title="Create a public before/after link"
    >
      {loading ? "Sharing…" : "Share"}
    </button>
  );
}
