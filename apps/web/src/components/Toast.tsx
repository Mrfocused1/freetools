"use client";

import { useEffect, useState } from "react";

type ToastItem = { id: number; text: string; tone: "info" | "error" };
type Store = {
  items: ToastItem[];
  subscribers: Set<() => void>;
  seq: number;
};

// Lightweight global store — no context, no external deps. Works across components.
const store: Store = { items: [], subscribers: new Set(), seq: 0 };

function notify() {
  store.subscribers.forEach((fn) => fn());
}

export function useToast() {
  return {
    show(text: string, opts?: { tone?: "info" | "error" }) {
      const id = ++store.seq;
      store.items = [...store.items, { id, text, tone: opts?.tone ?? "info" }];
      notify();
      setTimeout(() => {
        store.items = store.items.filter((t) => t.id !== id);
        notify();
      }, 3500);
    },
  };
}

export function Toast() {
  const [, forceRender] = useState(0);
  useEffect(() => {
    const fn = () => forceRender((n) => n + 1);
    store.subscribers.add(fn);
    return () => {
      store.subscribers.delete(fn);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex flex-col items-end gap-2">
      {store.items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto rounded-md border px-4 py-2 text-sm shadow-lg backdrop-blur animate-[fadeIn_.2s_ease] ${
            t.tone === "error"
              ? "border-red-500/30 bg-red-950/60 text-red-200"
              : "border-[var(--color-border)] bg-[var(--color-surface)]/90 text-[var(--color-fg)]"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
