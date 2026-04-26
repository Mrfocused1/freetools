import Link from "next/link";
import { ThemeToggle } from "./ThemeToggle";

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-bg)]/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-6 w-6 rounded-md bg-[var(--color-accent)]" />
          <span>Quick Fix</span>
        </Link>
        <nav className="flex items-center gap-4 text-sm md:gap-6">
          <Link href="/" className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            Background
          </Link>
          <Link href="/upscale" className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            Upscale
          </Link>
          <Link href="/edit-pdf" className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            Edit PDF
          </Link>
          <Link href="/research" className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            AI Research
          </Link>
          <Link href="/pricing" className="text-[var(--color-muted)] hover:text-[var(--color-fg)]">
            Pricing
          </Link>
          <ThemeToggle />
          <Link
            href="/login"
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[var(--color-fg)] hover:border-[var(--color-accent)]"
          >
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
