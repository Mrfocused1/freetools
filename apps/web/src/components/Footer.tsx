export function Footer() {
  return (
    <footer className="mt-24 border-t border-[var(--color-border)]">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-6 py-10 text-sm text-[var(--color-muted)] md:flex-row md:items-center">
        <p>© {new Date().getFullYear()} Quick Fix</p>
        <nav className="flex gap-6">
          <a href="/pricing">Pricing</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
          <a href="mailto:support@quickfix.app">Support</a>
        </nav>
      </div>
    </footer>
  );
}
