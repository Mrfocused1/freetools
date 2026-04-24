"use client";

import { useState } from "react";

type Props =
  | { tier: "free" | "pro" | "business"; credits?: never }
  | { credits: "small" | "large"; tier?: never };

export function CheckoutButton(props: Props) {
  const [loading, setLoading] = useState(false);

  if (props.tier === "free") {
    return (
      <a
        href="/"
        className="block rounded-md border border-[var(--color-border)] px-4 py-2 text-center text-sm font-medium"
      >
        Start free
      </a>
    );
  }

  async function onClick() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(props),
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

  const label = props.tier
    ? `Choose ${props.tier === "pro" ? "Pro" : "Business"}`
    : "Buy credits";
  const primary = props.tier === "pro";

  return (
    <button
      onClick={onClick}
      disabled={loading}
      className={`block w-full rounded-md px-4 py-2 text-center text-sm font-medium disabled:opacity-60 ${
        primary
          ? "bg-[var(--color-accent)] text-white hover:bg-[var(--color-accent-hover)]"
          : "border border-[var(--color-border)]"
      }`}
    >
      {loading ? "Loading…" : label}
    </button>
  );
}
