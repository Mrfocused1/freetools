"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemeToggle } from "./ThemeToggle";

const NAV_LINKS = [
  { href: "/", label: "Background" },
  { href: "/upscale", label: "Upscale" },
  { href: "/edit-pdf", label: "Edit PDF" },
  { href: "/research", label: "AI Research" },
  { href: "/pricing", label: "Pricing" },
];

export function Navbar() {
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
        <Link
          href="/"
          className="flex items-center gap-2 whitespace-nowrap font-semibold tracking-tight"
          onClick={() => setOpen(false)}
        >
          <span className="inline-block h-6 w-6 rounded-md bg-[var(--color-accent)]" />
          <span>Quick Fix</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-5 text-sm md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="whitespace-nowrap text-[var(--color-muted)] hover:text-[var(--color-fg)]"
            >
              {l.label}
            </Link>
          ))}
          <ThemeToggle />
          <Link
            href="/login"
            className="whitespace-nowrap rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-fg)] hover:border-[var(--color-accent)]"
          >
            Sign in
          </Link>
        </nav>

        {/* Mobile: theme toggle + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--color-border)] hover:border-[var(--color-accent)]"
          >
            {open ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6 18 18M6 18 18 6" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile menu drawer */}
      {open && (
        <nav className="border-t border-[var(--color-border)] bg-[var(--color-bg)] md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-6 py-3 text-sm">
            {NAV_LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-2 text-[var(--color-muted)] hover:bg-[var(--color-surface)] hover:text-[var(--color-fg)]"
              >
                {l.label}
              </Link>
            ))}
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="mt-1 rounded-md border border-[var(--color-border)] px-3 py-2 text-center text-[var(--color-fg)] hover:border-[var(--color-accent)]"
            >
              Sign in
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
