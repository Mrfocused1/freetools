"use client";

import { useState } from "react";

export function BuyCreditsButton({
  pack,
  label,
  price,
  variant = "secondary",
}: {
  pack: "small" | "large";
  label: string;
  price: string;
  variant?: "primary" | "secondary";
}) {
  const [loading, setLoading] = useState(false);

  async function onClick() {
    try {
      setLoading(true);
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credits: pack }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Checkout failed" }));
        alert(err.error ?? "Checkout failed");
        return;
      }
      const { url } = await res.json();
      window.location.href = url;
    } finally {
      setLoading(false);
    }
  }

  const classes =
    variant === "primary"
      ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
      : "border border-[var(--color-border)] hover:border-[var(--color-accent)]";

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`w-full rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-60 ${classes}`}
    >
      {loading ? "…" : `${label} · ${price}`}
    </button>
  );
}
