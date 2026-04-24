import Link from "next/link";

// Subtle "made with" credit on anonymous free-tier results.
// For signed-in users this can be opted out of later via a profile setting.
export function MadeWithFooter() {
  return (
    <p className="mt-2 text-center text-[11px] text-[var(--color-muted)]">
      Background removed with{" "}
      <Link href="/" className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-fg)]">
        Quick Fix
      </Link>
      {" "}— free online AI tools.
    </p>
  );
}
